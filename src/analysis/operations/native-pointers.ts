import { tsonicNativePointerOperationFactKey } from "@tsonic/source-core/facts";
import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoNativePointerTargetId } from "../../providers/builtins/source-types.js";
import type { MojoCallSelection } from "../program/model.js";
import { hasExplicitUnsafeContext } from "../safety/explicit-context.js";

export type MojoNativePointerAnalysis =
  | { readonly kind: "not-native-pointer" }
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoNativePointer(input: {
  readonly call: Node;
  readonly sourceCall: ResolvedSourceCallInfo;
  readonly source: TargetSourceProgram;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly resolveType: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined;
}): MojoNativePointerAnalysis {
  const fact = input.source.sourceFacts.getFact(input.call, tsonicNativePointerOperationFactKey);
  if (fact === undefined) return { kind: "not-native-pointer" };
  if (!argumentsMatch(input.sourceCall, fact)) {
    return unsupported(
      "MOJO_NATIVE_POINTER_EVIDENCE_CONFLICT",
      "The selected source arguments do not match the exact finalized native-pointer operation.",
    );
  }
  if (!hasExplicitUnsafeContext(input.call, input.source)) {
    return unsupported(
      "MOJO_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED",
      `Mojo native-pointer '${fact.operation}' requires an explicit unsafeContext source region.`,
    );
  }
  const pointerType = input.expressionTypes.get(fact.pointerExpression) ??
    input.resolveType(fact.pointerType);
  const pointeeType = pointerPointee(pointerType);
  const authoredPointee = fact.explicitPointeeTypeNode === undefined
    ? undefined
    : input.resolveType(fact.pointeeType, fact.explicitPointeeTypeNode);
  if (pointerType === undefined || pointeeType === undefined ||
    (fact.explicitPointeeTypeNode !== undefined &&
      (authoredPointee === undefined || !mojoTargetTypeEquals(pointeeType, authoredPointee)))) {
    return unsupported(
      "MOJO_NATIVE_POINTER_POINTEE_CONFLICT",
      "The selected native-pointer operand and authored pointee do not have one exact Mojo carrier.",
    );
  }
  if (fact.resultType !== input.sourceCall.sourceResultType) {
    return unsupported(
      "MOJO_NATIVE_POINTER_RESULT_CONFLICT",
      "The retained native-pointer result is not owned by the exact selected call result.",
    );
  }
  if (fact.operation === "load") {
    return resolved({
      kind: "native-pointer",
      operation: "load",
      pointerExpression: fact.pointerExpression,
      pointerType,
      pointeeType,
      resultType: pointeeType,
    });
  }
  if (fact.operation === "store") {
    const valueType = input.expressionTypes.get(fact.valueExpression) ??
      input.resolveType(fact.valueType);
    if (valueType === undefined || !mojoTargetTypeEquals(valueType, pointeeType)) {
      return unsupported(
        "MOJO_NATIVE_POINTER_STORE_VALUE_CONFLICT",
        "The selected native-pointer store value does not have the exact pointee carrier.",
      );
    }
    return resolved({
      kind: "native-pointer",
      operation: "store",
      pointerExpression: fact.pointerExpression,
      pointerType,
      pointeeType,
      valueExpression: fact.valueExpression,
      valueType,
      resultType: Object.freeze({ kind: "unit" }),
    });
  }
  const offsetType = input.expressionTypes.get(fact.offsetExpression) ??
    input.resolveType(fact.offsetType);
  if (offsetType?.kind !== "source-primitive" || offsetType.name !== "native-int") {
    return unsupported(
      "MOJO_NATIVE_POINTER_OFFSET_TYPE_CONFLICT",
      "The selected native-pointer element offset is not exactly native-int in Mojo.",
    );
  }
  return resolved({
    kind: "native-pointer",
    operation: "offset",
    pointerExpression: fact.pointerExpression,
    pointerType,
    pointeeType,
    offsetExpression: fact.offsetExpression,
    offsetType,
    resultType: pointerType,
  });
}

function pointerPointee(type: MojoTargetTypeRef | undefined): MojoTargetTypeRef | undefined {
  if (type?.kind !== "target-named" || type.id !== mojoNativePointerTargetId) return undefined;
  const first = type.genericArguments?.[0];
  return first?.kind === "type" ? first.type : undefined;
}

function argumentsMatch(
  call: ResolvedSourceCallInfo,
  fact: import("@tsonic/source-core/facts").TsonicNativePointerOperationFact,
): boolean {
  const expected = fact.operation === "load"
    ? [fact.pointerExpression]
    : fact.operation === "store"
      ? [fact.pointerExpression, fact.valueExpression]
      : [fact.pointerExpression, fact.offsetExpression];
  return call.sourceArguments.length === expected.length &&
    call.sourceArguments.every((argument, index) => argument.expression === expected[index]);
}

function resolved(
  selection: Extract<MojoCallSelection, { readonly kind: "native-pointer" }>,
): MojoNativePointerAnalysis {
  return { kind: "resolved", selection: Object.freeze(selection) };
}

function unsupported(code: string, reason: string): MojoNativePointerAnalysis {
  return { kind: "unsupported", code, reason };
}
