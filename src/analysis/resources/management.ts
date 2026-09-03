import type {
  Node,
  ResolvedSourceResourceManagementInfo,
  Type,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import type {
  MojoAnalyzedProjectCallable,
  MojoResourceDisposalAlternative,
  MojoResourceDisposalSelection,
  MojoResourceManagementSelection,
} from "../program/model.js";

export type MojoResourceManagementAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoResourceManagementSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoResourceManagement(input: {
  readonly declaration: Node;
  readonly source: TargetSourceProgram;
  readonly sourceInfo: ResolvedSourceResourceManagementInfo;
  readonly providerSemantics: MojoProviderSemantics;
  readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
}): MojoResourceManagementAnalysis {
  const { declaration, sourceInfo } = input;
  if (sourceInfo.declaration !== declaration || sourceInfo.disposal.kind !== "selected") {
    return unsupported(
      "MOJO_RESOURCE_DISPOSAL_NOT_SELECTED",
      "Resource management requires one checker-selected disposal contract.",
    );
  }
  const bindingName = input.bindingNames.get(declaration);
  const storageType = input.bindingTypes.get(declaration) ??
    input.resolveType(sourceInfo.sourceResourceType);
  const storage = resourceStorage(storageType);
  if (bindingName === undefined || storageType === undefined || storage === undefined) {
    return unsupported(
      "MOJO_RESOURCE_STORAGE_NOT_CLOSED",
      "The selected resource declaration has no exact binding, storage, and non-null target carrier.",
    );
  }
  const alternatives = sourceInfo.disposal.alternatives.map((alternative) =>
    selectDisposal(alternative, input));
  const rejected = alternatives.find((alternative) => alternative.kind === "unsupported");
  if (rejected?.kind === "unsupported") return rejected;
  const selected = alternatives as readonly {
    readonly kind: "resolved";
    readonly alternative: MojoResourceDisposalAlternative;
  }[];
  const closed = closeAlternatives(storage.resourceType, selected.map(({ alternative }) => alternative));
  if (closed === undefined) {
    return unsupported(
      "MOJO_RESOURCE_DISPOSAL_ALTERNATIVES_CONFLICT",
      "Every non-null resource carrier must have one exact, non-conflicting checker-selected Mojo disposal operation.",
    );
  }
  if (sourceInfo.declarationKind === "using" &&
    closed.some(({ disposal }) => disposal.asynchronous)) {
    return unsupported(
      "MOJO_SYNC_RESOURCE_ASYNC_DISPOSER",
      "A synchronous using declaration cannot select an asynchronous Mojo disposer.",
    );
  }
  return {
    kind: "resolved",
    selection: Object.freeze({
      declaration,
      declarationKind: sourceInfo.declarationKind,
      bindingName,
      storageType,
      resourceType: storage.resourceType,
      storageMode: storage.mode,
      alternatives: closed,
    }),
  };
}

type SourceAlternative = Extract<
  ResolvedSourceResourceManagementInfo["disposal"],
  { readonly kind: "selected" }
>["alternatives"][number];

function selectDisposal(
  alternative: SourceAlternative,
  input: Parameters<typeof analyzeMojoResourceManagement>[0],
):
  | { readonly kind: "resolved"; readonly alternative: MojoResourceDisposalAlternative }
  | Extract<MojoResourceManagementAnalysis, { readonly kind: "unsupported" }> {
  const selectedCarrier = input.resolveType(alternative.sourceType);
  const selectedResource = nullableElement(selectedCarrier) ?? selectedCarrier;
  if (selectedResource === undefined) {
    return unsupported(
      "MOJO_RESOURCE_ALTERNATIVE_CARRIER_CONFLICT",
      "A selected disposal alternative has no exact Mojo resource carrier.",
    );
  }
  const project = alternative.selectedDeclaration === undefined
    ? undefined
    : input.callableByDeclaration.get(alternative.selectedDeclaration);
  if (project !== undefined) {
    const contract = project.contract;
    if (contract.kind !== "method" || contract.static === true || contract.owner === undefined ||
      contract.parameters.length !== 0 || contract.resultType.kind !== "unit" ||
      contract.asynchronous !== (alternative.kind === "async") ||
      !projectOwnerMatches(contract.owner.type, selectedResource)) {
      return unsupported(
        "MOJO_PROJECT_RESOURCE_DISPOSER_ABI_CONFLICT",
        "The checker-selected project disposer does not have one exact zero-argument receiver ABI.",
      );
    }
    return {
      kind: "resolved",
      alternative: Object.freeze({
        resourceType: selectedResource,
        disposal: Object.freeze({
          kind: "project",
          name: contract.name,
          asynchronous: contract.asynchronous,
          raises: contract.raises,
          dependency: project.implementation?.declaration ?? contract.declaration,
        }),
      }),
    };
  }
  const identity = selectedProviderDeclarationIdentity(input.source, [
    alternative.selectedDeclaration,
    alternative.selectedSymbol,
  ]);
  if (identity?.exportId === undefined || identity.memberId === undefined || identity.signatureId === undefined) {
    return unsupported(
      "MOJO_RESOURCE_DISPOSER_IDENTITY_MISSING",
      "The selected disposer has neither a project callable nor an exact provider declaration identity.",
    );
  }
  const rows = input.providerSemantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.memberId === identity.memberId && row.signatureId === identity.signatureId &&
    row.operationKind === "call");
  if (rows.length !== 1) {
    return unsupported(
      rows.length === 0
        ? "MOJO_RESOURCE_PROVIDER_OPERATION_MISSING"
        : "MOJO_RESOURCE_PROVIDER_OPERATION_AMBIGUOUS",
      `The selected provider disposer maps to ${rows.length} exact Mojo operations.`,
    );
  }
  const row = rows[0]!;
  const target = row.target;
  if ((target.kind !== "instance-call" && !(target.kind === "function-call" && target.receiver !== undefined)) ||
    row.receiverType === undefined || !mojoTargetTypeEquals(row.receiverType, selectedResource) ||
    (row.parameterTypes?.length ?? 0) !== 0 || row.resultType.kind !== "unit" ||
    (target.genericParameters?.length ?? 0) !== 0) {
    return unsupported(
      "MOJO_RESOURCE_PROVIDER_ABI_CONFLICT",
      "The selected provider disposer does not have one exact non-generic zero-argument receiver ABI.",
    );
  }
  const operation: MojoSelectedProviderOperation = Object.freeze({
    target,
    receiverType: row.receiverType,
    parameterTypes: Object.freeze([]),
    resultType: row.resultType,
    genericArguments: Object.freeze([]),
    genericParameters: Object.freeze([]),
    raises: row.raises === true,
  });
  return {
    kind: "resolved",
    alternative: Object.freeze({
      resourceType: selectedResource,
      disposal: Object.freeze({
        kind: "provider",
        identity: providerOperationIdentity(row),
        operation,
        asynchronous: alternative.kind === "async",
      }),
    }),
  };
}

function nullableElement(type: MojoTargetTypeRef | undefined): MojoTargetTypeRef | undefined {
  return type?.kind === "optional" ? type.value : undefined;
}

function resourceStorage(type: MojoTargetTypeRef | undefined): {
  readonly resourceType: MojoTargetTypeRef;
  readonly mode: MojoResourceManagementSelection["storageMode"];
} | undefined {
  if (type === undefined) return undefined;
  if (type.kind === "optional") return { resourceType: type.value, mode: "optional" };
  if (type.kind !== "union") return { resourceType: type, mode: "direct" };
  const valueMembers = type.members.filter((member) =>
    member.kind !== "null" && member.kind !== "undefined");
  if (valueMembers.length === type.members.length) return { resourceType: type, mode: "direct" };
  if (valueMembers.length === 0) return undefined;
  return {
    resourceType: valueMembers.length === 1
      ? valueMembers[0]!
      : Object.freeze({ kind: "union", members: Object.freeze(valueMembers) }),
    mode: "nullish-union",
  };
}

function sameDisposal(
  left: MojoResourceDisposalSelection,
  right: MojoResourceDisposalSelection,
): boolean {
  if (left.kind !== right.kind || left.asynchronous !== right.asynchronous) return false;
  if (left.kind === "project" && right.kind === "project") {
    return left.dependency === right.dependency && left.name === right.name && left.raises === right.raises;
  }
  return left.kind === "provider" && right.kind === "provider" &&
    left.identity === right.identity;
}

function closeAlternatives(
  resourceType: MojoTargetTypeRef,
  alternatives: readonly MojoResourceDisposalAlternative[],
): readonly MojoResourceDisposalAlternative[] | undefined {
  const members = resourceType.kind === "union" ? resourceType.members : Object.freeze([resourceType]);
  const closed = members.map((member) => {
    const matches = alternatives.filter((alternative) =>
      mojoTargetTypeEquals(alternative.resourceType, member));
    const first = matches[0];
    return first === undefined || matches.some((entry) => !sameDisposal(first.disposal, entry.disposal))
      ? undefined
      : first;
  });
  if (closed.some((entry) => entry === undefined) ||
    alternatives.some((alternative) => !members.some((member) =>
      mojoTargetTypeEquals(alternative.resourceType, member)))) return undefined;
  return Object.freeze(closed as readonly MojoResourceDisposalAlternative[]);
}

function projectOwnerMatches(
  owner: MojoTargetTypeRef,
  resource: MojoTargetTypeRef,
): boolean {
  if (owner.kind !== "target-named" || resource.kind !== "target-named" ||
    owner.id !== resource.id || owner.name !== resource.name ||
    owner.modulePath.length !== resource.modulePath.length ||
    owner.modulePath.some((segment, index) => segment !== resource.modulePath[index])) return false;
  const ownerArguments = owner.genericArguments ?? [];
  const resourceArguments = resource.genericArguments ?? [];
  if (ownerArguments.length !== resourceArguments.length) return false;
  return ownerArguments.every((argument, index) => {
    const selected = resourceArguments[index];
    return argument.kind === "type" && argument.type.kind === "type-parameter"
      ? selected?.kind === "type"
      : selected !== undefined && JSON.stringify(argument) === JSON.stringify(selected);
  });
}

function providerOperationIdentity(
  row: MojoProviderSemantics["operations"][number],
): string {
  return [
    row.providerPackageId,
    row.providerId,
    row.providerVersion,
    row.providerModuleId,
    row.moduleSpecifier,
    row.exportId,
    row.memberId ?? "",
    row.signatureId ?? "",
    row.operationKind,
  ].join("\0");
}

function unsupported(
  code: string,
  reason: string,
): Extract<MojoResourceManagementAnalysis, { readonly kind: "unsupported" }> {
  return { kind: "unsupported", code, reason };
}
