import type { AstReader, Node } from "@tsonic/tsts";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoNullishCoalescingSelection } from "../program/model.js";
import {
  classifyMojoRefinedValueConversion,
  classifyMojoValueRefinement,
} from "../refinements/value.js";

export type MojoNullishCoalescingAnalysis =
  | {
      readonly kind: "resolved";
      readonly selection: MojoNullishCoalescingSelection;
      readonly expressionType: MojoTargetTypeRef;
    }
  | { readonly kind: "unsupported"; readonly reason: string };

export function analyzeMojoNullishCoalescing(
  left: Node,
  right: Node,
  leftType: MojoTargetTypeRef,
  rightType: MojoTargetTypeRef,
  selectedResultType: MojoTargetTypeRef | undefined,
  ast: AstReader,
): MojoNullishCoalescingAnalysis {
  const present = presentType(leftType);
  if (present === undefined) {
    const conversion = classifyMojoValueConversion(rightType, rightType);
    return conversion.kind === "unsupported"
      ? unsupported(conversion.reason)
      : resolved(rightType, Object.freeze({
          kind: "right",
          left,
          right,
          resultType: rightType,
          conversion: conversion.conversion,
        }));
  }
  if (!mayBeNullish(leftType)) {
    const conversion = classifyMojoValueConversion(leftType, leftType);
    return conversion.kind === "unsupported"
      ? unsupported(conversion.reason)
      : resolved(leftType, Object.freeze({
          kind: "left",
          left,
          resultType: leftType,
          conversion: conversion.conversion,
        }));
  }
  const resultType = selectResultType(
    present,
    rightType,
    selectedResultType,
    isNumericLiteral(right, ast),
  );
  if (resultType === undefined) {
    return unsupported("The present left value and fallback have no single exact Mojo result carrier.");
  }
  const presentRefinement = leftType.kind === "union"
    ? classifyMojoValueRefinement(leftType, present)
    : undefined;
  const presentConversion = classifyMojoRefinedValueConversion(
    present,
    resultType,
    presentRefinement,
  );
  const rightConversion = classifyMojoValueConversion(rightType, resultType);
  if (presentConversion.kind === "unsupported") return unsupported(presentConversion.reason);
  if (rightConversion.kind === "unsupported") return unsupported(rightConversion.reason);
  if (leftType.kind === "optional") {
    return resolved(resultType, Object.freeze({
      kind: "optional",
      left,
      right,
      leftType,
      presentType: present,
      resultType,
      presentConversion: presentConversion.conversion,
      rightConversion: rightConversion.conversion,
    }));
  }
  if (leftType.kind !== "union") {
    return unsupported("A nullable left carrier must be Optional[T] or a closed union.");
  }
  if (presentRefinement === undefined) {
    return unsupported("The closed nullable union has no exact non-nullish projection.");
  }
  return resolved(resultType, Object.freeze({
    kind: "union",
    left,
    right,
    leftType,
    presentType: present,
    resultType,
    presentConversion: presentConversion.conversion,
    rightConversion: rightConversion.conversion,
    presentRefinement,
  }));
}

function presentType(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (type.kind === "null" || type.kind === "undefined") return undefined;
  if (type.kind === "optional") return type.value;
  if (type.kind !== "union") return type;
  const members = type.members.filter((member) => member.kind !== "null" && member.kind !== "undefined");
  if (members.length === 0) return undefined;
  if (members.length === 1) return members[0];
  return Object.freeze({ kind: "union", members: Object.freeze(members) });
}

function mayBeNullish(type: MojoTargetTypeRef): boolean {
  return type.kind === "null" || type.kind === "undefined" || type.kind === "optional" ||
    type.kind === "union" && type.members.some((member) =>
      member.kind === "null" || member.kind === "undefined");
}

function selectResultType(
  present: MojoTargetTypeRef,
  fallback: MojoTargetTypeRef,
  selected: MojoTargetTypeRef | undefined,
  fallbackIsNumericLiteral: boolean,
): MojoTargetTypeRef | undefined {
  if (mojoTargetTypeEquals(present, fallback)) return present;
  if (fallbackIsNumericLiteral && isNumericCarrier(present) && isNumericCarrier(fallback)) {
    return conversionsClose(present, fallback, present) ? present : undefined;
  }
  const structural = structuralResultType(present, fallback);
  if (structural !== undefined && conversionsClose(present, fallback, structural)) return structural;
  if (selected !== undefined && conversionsClose(present, fallback, selected)) return selected;
  return undefined;
}

function structuralResultType(
  present: MojoTargetTypeRef,
  fallback: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  if (fallback.kind === "undefined") {
    return Object.freeze({ kind: "optional", value: present });
  }
  if (fallback.kind === "optional" && mojoTargetTypeEquals(fallback.value, present)) return fallback;
  if (present.kind === "union" && present.members.some((member) => mojoTargetTypeEquals(member, fallback))) {
    return present;
  }
  if (fallback.kind === "union" && fallback.members.some((member) => mojoTargetTypeEquals(member, present))) {
    return fallback;
  }
  const members = present.kind === "union" ? [...present.members] : [present];
  for (const candidate of fallback.kind === "union" ? fallback.members : [fallback]) {
    if (!members.some((member) => mojoTargetTypeEquals(member, candidate))) members.push(candidate);
  }
  return Object.freeze({ kind: "union", members: Object.freeze(members) });
}

function conversionsClose(
  present: MojoTargetTypeRef,
  fallback: MojoTargetTypeRef,
  result: MojoTargetTypeRef,
): boolean {
  return classifyMojoValueConversion(present, result).kind === "resolved" &&
    classifyMojoValueConversion(fallback, result).kind === "resolved";
}

function isNumericLiteral(node: Node, ast: AstReader): boolean {
  return ast.is.IsNumericLiteral(node) || ast.is.IsBigIntLiteral(node);
}

function isNumericCarrier(type: MojoTargetTypeRef): boolean {
  return type.kind === "source-primitive" && type.name !== "bool" && type.name !== "char";
}

function resolved(
  expressionType: MojoTargetTypeRef,
  selection: MojoNullishCoalescingSelection,
): MojoNullishCoalescingAnalysis {
  return { kind: "resolved", expressionType, selection };
}

function unsupported(reason: string): MojoNullishCoalescingAnalysis {
  return { kind: "unsupported", reason };
}
