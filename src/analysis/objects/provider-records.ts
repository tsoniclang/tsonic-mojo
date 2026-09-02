import type { Node, SourceFile, Type } from "@tsonic/tsts";
import { ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics, MojoProviderTypeRow } from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { instantiateMojoProviderPropertyOperation } from "../../policy/operations/provider-instantiation.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import { selectMojoProviderObjectLiteralConstruction } from "../../policy/types/provider-object-literals.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type { MojoObjectLiteralSelection } from "../program/model.js";

export interface MojoProviderRecordAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
  readonly expression: Node;
  readonly expectedType?: MojoTargetTypeRef;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly providerSemantics: MojoProviderSemantics;
  readonly conversions: MojoConversionIndex;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
  readonly diagnostics: TargetDiagnostic[];
}

export function analyzeMojoProviderRecordLiteral(
  input: MojoProviderRecordAnalysisInput,
): MojoObjectLiteralSelection | undefined {
  const semantics = input.source.semantics.forFile(input.sourceFile);
  const construction = selectMojoProviderObjectLiteralConstruction(
    input.source,
    input.expression,
    input.expectedType,
    semantics,
    input.providerSemantics,
    input.resolveType,
  );
  if (construction.kind === "not-applicable") return undefined;
  if (construction.kind === "conflict") {
    reject(input, construction.reason, input.expression);
    return undefined;
  }
  const inventory = targetFieldInventory(
    construction.typeRow,
    construction.targetType,
    input.providerSemantics,
  );
  if (inventory === undefined) {
    reject(input, "Provider object-literal construction requires one complete exact readable/writable native field inventory.", input.expression);
    return undefined;
  }
  const fields: Extract<MojoObjectLiteralSelection, { readonly kind: "provider-record" }>["fields"][number][] = [];
  for (const property of input.source.ast.properties(input.expression)) {
    if (property === undefined ||
      (!input.source.ast.is.IsPropertyAssignment(property) &&
        !input.source.ast.is.IsShorthandPropertyAssignment(property))) {
      reject(input, "Provider object literals accept only exact ordinary property and shorthand selections.", property ?? input.expression);
      return undefined;
    }
    const selected = semantics.operations.objectLiteralElement(property);
    const value = ObjectLiteralProperty_Value(input.source.ast, property);
    if (selected === undefined || selected.objectLiteral !== input.expression ||
      selected.element !== property || value === undefined ||
      (selected.elementKind !== "property" && selected.elementKind !== "shorthand")) {
      reject(input, "Provider object-literal property has no exact selected source evidence.", property);
      return undefined;
    }
    const identity = selectedProviderDeclarationIdentity(input.source, [
      selected.sourceSelectedSymbol,
      selected.sourceSelectedDeclaration,
      ...selected.sourceSelectedDeclarations,
    ]);
    if (identity?.memberId === undefined || identity.exportId !== construction.typeRow.exportId ||
      !providerOwnerMatches(construction.typeRow, identity)) {
      reject(input, "Provider object-literal property does not identify one member owned by its selected provider type.", property);
      return undefined;
    }
    const field = inventory.get(identity.memberId);
    if (field === undefined) {
      reject(input, "Provider object-literal property has no exact readable/writable native field relation.", property);
      return undefined;
    }
    const sourceType = input.resolveType(selected.sourceElementType);
    if (sourceType === undefined) {
      reject(input, "Provider object-literal property has no closed source value carrier.", property);
      return undefined;
    }
    const conversion = input.conversions.record(value, sourceType, field.storageType);
    if (conversion.kind === "unsupported") {
      reject(input, `Provider object-literal field conversion is not exact: ${conversion.reason}.`, property);
      return undefined;
    }
    fields.push(Object.freeze({
      element: property,
      value,
      providerMemberId: identity.memberId,
      targetName: field.targetName,
      storageType: field.storageType,
    }));
  }
  if (new Set(fields.map((field) => field.providerMemberId)).size !== fields.length ||
    new Set(fields.map((field) => field.targetName)).size !== fields.length) {
    reject(input, "Provider object-literal properties do not form a one-to-one native field assignment.", input.expression);
    return undefined;
  }
  input.expressionTypes.set(input.expression, construction.targetType);
  return Object.freeze({
    kind: "provider-record",
    targetType: construction.targetType,
    fields: Object.freeze(fields),
  });
}

function targetFieldInventory(
  typeRow: MojoProviderTypeRow,
  receiverType: MojoTargetTypeRef,
  semantics: MojoProviderSemantics,
): ReadonlyMap<string, { readonly targetName: string; readonly storageType: MojoTargetTypeRef }> | undefined {
  const rows = semantics.operations.filter((row) =>
    providerOwnerMatches(row, typeRow) && row.exportId === typeRow.exportId &&
    (row.operationKind === "property" || row.operationKind === "property-set"));
  const reads = rows.filter((row) => row.operationKind === "property");
  const writes = rows.filter((row) => row.operationKind === "property-set");
  if (reads.length === 0 || reads.length !== writes.length) return undefined;
  const fields = new Map<string, { readonly targetName: string; readonly storageType: MojoTargetTypeRef }>();
  for (const readRow of reads) {
    const writeRows = writes.filter((row) => row.memberId === readRow.memberId);
    if (readRow.memberId === undefined || writeRows.length !== 1) return undefined;
    const read = instantiateMojoProviderPropertyOperation(readRow, receiverType);
    const write = instantiateMojoProviderPropertyOperation(writeRows[0]!, receiverType);
    if (read.kind !== "resolved" || write.kind !== "resolved" ||
      read.operation.target.kind !== "property-read" ||
      read.operation.target.access.kind !== "member" ||
      write.operation.target.kind !== "property-write" ||
      read.operation.target.access.name !== write.operation.target.access.name ||
      read.operation.receiverType === undefined || write.operation.receiverType === undefined ||
      !mojoTargetTypeEquals(read.operation.receiverType, receiverType) ||
      !mojoTargetTypeEquals(write.operation.receiverType, receiverType) ||
      write.operation.parameterTypes.length !== 1 ||
      !mojoTargetTypeEquals(read.operation.resultType, write.operation.parameterTypes[0]!) ||
      write.operation.resultType.kind !== "unit") return undefined;
    fields.set(readRow.memberId, Object.freeze({
      targetName: read.operation.target.access.name,
      storageType: read.operation.resultType,
    }));
  }
  return fields.size === reads.length &&
      writes.every((write) => write.memberId !== undefined && fields.has(write.memberId))
    ? fields
    : undefined;
}

function reject(input: MojoProviderRecordAnalysisInput, message: string, node: Node): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(
    "MOJO_PROVIDER_OBJECT_LITERAL_CONTRACT_INVALID",
    message,
    node,
  ));
}
