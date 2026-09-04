import type { Node, ResolvedSourceCallInfo } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoSourceProfileDeclarationIdentity,
  MojoSourceProfileRegistry,
} from "../types/source-profile.js";
import { mojoSourceProfileCallRows } from "./source-profile-rows.js";

export { mojoSourceProfileCallRows } from "./source-profile-rows.js";

export interface MojoSourceProfileCallRowBase {
  readonly profile: "native" | "js";
  readonly kind: "call" | "construct";
  readonly owner: string;
  readonly member: string;
  readonly argumentCount?: number;
  readonly argumentCarriers?: readonly MojoSourceProfileArgumentCarrierContract[];
  readonly parameterContract?: readonly MojoSourceProfileParameterContract[];
  readonly parameterContractMode?: "exact" | "overrides";
  readonly receiverCapability?: "integer";
  readonly raises?: boolean;
  readonly callback?: MojoSourceProfileCallbackContract;
  readonly resultContract?: MojoSourceProfileResultContract;
  readonly runtimeResultContract?:
    | {
        readonly kind: "optional-source-union";
        readonly absence: "null" | "undefined";
      }
    | { readonly kind: "native-error-result" };
}

export type MojoSourceProfileCallRow = MojoSourceProfileCallRowBase & (
  | {
      readonly specialOperation: "object-assign" | "json-stringify";
    }
  | {
  readonly target:
    | {
        readonly kind: "instance";
        readonly name: string;
        readonly receiver: "imm" | "mut" | "var" | "ref" | "deinit";
      }
    | {
        readonly kind: "function";
        readonly modulePath: readonly string[];
        readonly name: string;
        readonly receiver?: "imm" | "mut" | "var" | "ref" | "deinit";
      };
  }
);

export interface MojoSourceProfileArgumentCarrierContract {
  readonly index: number;
  readonly oneOf: readonly (
    | "native-string"
    | "js-string"
    | "regexp"
    | "callable"
    | "undefined"
  )[];
}

export type MojoSourceProfileResultContract =
  | {
      readonly kind: "constructed-explicit-arguments";
      readonly indexes?: readonly number[];
    }
  | {
      readonly kind: "receiver-array";
      readonly element:
        | { readonly kind: "receiver-argument"; readonly index: number }
        | { readonly kind: "tuple"; readonly indexes: readonly number[] };
    }
  | {
      readonly kind: "receiver-argument";
      readonly index: number;
      readonly optional?: boolean;
    };

export interface MojoSourceProfileCallbackContract {
  readonly parameterIndex: number;
  readonly result: "preserve" | "bool" | "float64";
  readonly errorMode: "propagate" | "native";
  readonly variants: readonly MojoSourceProfileCallbackVariant[];
}

export interface MojoSourceProfileCallbackVariant {
  readonly arity: number;
  readonly targetName: string;
}

export type MojoSourceProfileParameterContract =
  | "float64"
  | "js-string"
  | "js-value"
  | "native-string"
  | "selected-argument"
  | { readonly kind: "receiver" }
  | { readonly kind: "receiver-argument"; readonly index: number };

export type MojoSourceProfileCallRowSelection =
  | { readonly kind: "not-source-profile" }
  | {
      readonly kind: "selected";
      readonly identity: MojoSourceProfileDeclarationIdentity;
      readonly row: MojoSourceProfileCallRow;
    }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function selectMojoSourceProfileCallRow(
  source: TargetSourceProgram,
  call: ResolvedSourceCallInfo,
  profiles: MojoSourceProfileRegistry,
  argumentTypes: readonly (MojoTargetTypeRef | undefined)[],
): MojoSourceProfileCallRowSelection {
  const semantics = source.semantics.forNode(call.call);
  const signatureDeclaration = semantics.declarations.signatureDeclaration(call.selectedSignature);
  const identity = profiles.declarationIdentity(
    signatureDeclaration,
    source,
  );
  if (identity === undefined) return { kind: "not-source-profile" };
  const expectedKind = source.ast.is.IsNewExpression(call.call) ? "construct" : "call";
  const owner = identity.declaringName ?? identity.name;
  const member = expectedKind === "construct"
    ? "constructor"
    : identity.name ?? (identity.kind === "call" ? "call" : undefined);
  if (owner === undefined || member === undefined ||
    (identity.kind !== expectedKind && identity.kind !== "member")) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALL_IDENTITY_INCOMPLETE",
      reason: "The exact selected source-profile signature has no closed owner, member, and call kind.",
    };
  }
  const calleeIdentities = [
    call.sourceCallee.selectedDeclaration,
    call.sourceCalleeAccess?.selectedDeclaration,
  ].flatMap((declaration) => {
    const selected = profiles.declarationIdentity(
      declaration,
      source,
    );
    return selected === undefined ? [] : [selected];
  });
  if (calleeIdentities.some((selected) => selected.profile !== identity.profile)) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALL_IDENTITY_CONFLICT",
      reason: "The exact selected signature and callee declarations belong to different source profiles.",
    };
  }
  const argumentCount = call.sourceArguments.length;
  const rows = mojoSourceProfileCallRows.filter((row) =>
    row.profile === identity.profile && row.kind === expectedKind &&
    row.owner === owner && row.member === member &&
    (row.argumentCount === undefined || row.argumentCount === argumentCount) &&
    sourceProfileArgumentCarriersMatch(row.argumentCarriers, argumentTypes));
  if (rows.length !== 1) {
    return {
      kind: "unsupported",
      code: rows.length === 0
        ? "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED"
        : "MOJO_SOURCE_PROFILE_CALL_AMBIGUOUS",
      reason: `The exact source-profile call '${owner}.${member}' with ${argumentCount} arguments has ${rows.length} Mojo policy rows.`,
    };
  }
  return Object.freeze({ kind: "selected", identity, row: rows[0]! });
}

function sourceProfileArgumentCarriersMatch(
  contracts: readonly MojoSourceProfileArgumentCarrierContract[] | undefined,
  argumentTypes: readonly (MojoTargetTypeRef | undefined)[],
): boolean {
  return contracts === undefined || contracts.every((contract) => {
    const type = argumentTypes[contract.index];
    return type !== undefined && contract.oneOf.some((kind) => {
      switch (kind) {
        case "native-string": return type.kind === "native-string";
        case "js-string":
          return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
        case "regexp":
          return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsRegExp";
        case "callable": return type.kind === "callable";
        case "undefined": return type.kind === "undefined";
      }
    });
  });
}

export function selectedMojoSourceProfileDeclarationIdentity(
  source: TargetSourceProgram,
  profiles: MojoSourceProfileRegistry,
  declarations: readonly (Node | undefined)[],
): MojoSourceProfileDeclarationIdentity | undefined {
  let selected: MojoSourceProfileDeclarationIdentity | undefined;
  for (const declaration of declarations) {
    if (declaration === undefined) continue;
    const identity = profiles.declarationIdentity(
      declaration,
      source,
    );
    if (identity === undefined) continue;
    if (selected !== undefined && !sameSourceProfileIdentity(selected, identity)) return undefined;
    selected = identity;
  }
  return selected;
}

function sameSourceProfileIdentity(
  left: MojoSourceProfileDeclarationIdentity,
  right: MojoSourceProfileDeclarationIdentity,
): boolean {
  return left.profile === right.profile && left.kind === right.kind &&
    left.declaringName === right.declaringName && left.name === right.name;
}
