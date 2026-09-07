import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoNumericConversion, MojoNumericOperation } from "../../../target-model/operations/numeric.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoNumericConversion(
  value: MojoExpression,
  conversion: MojoNumericConversion,
  context: MojoPlanningContext,
): MojoExpression {
  if (conversion.kind === "identity") return value;
  registerMojoTypeImports(conversion.targetType, context);
  return Object.freeze({ kind: "construct", type: conversion.targetType, arguments: Object.freeze([Object.freeze({ value })]) });
}

export function planMojoNumericValue(
  operation: MojoNumericOperation,
  left: MojoExpression,
  right: MojoExpression | undefined,
  context: MojoPlanningContext,
): MojoExpression {
  const operand = planMojoNumericConversion(left, operation.leftConversion, context);
  const rightOperand = right === undefined || operation.rightConversion === undefined
    ? undefined
    : planMojoNumericConversion(right, operation.rightConversion, context);
  if (operation.implementation.kind === "source-number") {
    return Object.freeze({
      kind: "call",
      callee: mojoModuleMemberExpression(context, ["tsonic_runtime", "numeric"], operation.implementation.name),
      arguments: Object.freeze([operand, ...(rightOperand === undefined ? [] : [rightOperand])]
        .map((value) => Object.freeze({ value }))),
    });
  }
  const unsignedType = operation.implementation.unsignedType;
  if (unsignedType !== undefined && rightOperand !== undefined) {
    const unsigned = Object.freeze({ kind: "primitive-cast" as const, targetType: unsignedType });
    const shifted: MojoExpression = Object.freeze({
      kind: "binary", operator: ">>",
      left: planMojoNumericConversion(operand, unsigned, context),
      right: planMojoNumericConversion(rightOperand, unsigned, context),
    });
    return planMojoNumericConversion(shifted, Object.freeze({ kind: "primitive-cast", targetType: operation.resultType }), context);
  }
  return rightOperand === undefined
    ? Object.freeze({ kind: "unary", operator: operation.operator, operand })
    : Object.freeze({ kind: "binary", operator: operation.operator, left: operand, right: rightOperand, evaluation: "read-only" });
}

export function planMojoNumericExpression(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.intrinsicExpressionSelection(node);
  if (selection?.kind !== "numeric") return undefined;
  const left = planValue(selection.operand, context);
  const right = selection.right === undefined ? undefined : planValue(selection.right, context);
  const leftType = context.program.queries.expressionType(selection.operand);
  const rightType = selection.right === undefined ? undefined : context.program.queries.expressionType(selection.right);
  if (left === undefined || leftType === undefined ||
    (selection.right !== undefined && (right === undefined || rightType === undefined))) return undefined;
  const values = orderMojoValues([
    Object.freeze({ plan: left, type: leftType, role: "bitwise_left" }),
    ...(right === undefined || rightType === undefined ? [] : [Object.freeze({ plan: right, type: rightType, role: "bitwise_right" })]),
  ], context);
  return withMojoValue(values.before, planMojoNumericValue(selection.operation, values.values[0]!, values.values[1], context));
}

export function planMojoCompoundValue(
  node: Node,
  operator: string,
  left: MojoExpression,
  right: MojoExpression,
  context: MojoPlanningContext,
): MojoExpression {
  const selection = context.program.queries.intrinsicExpressionSelection(node);
  if (selection?.kind !== "numeric") {
    if (operator !== "+=" && operator !== "-=" && operator !== "*=" && operator !== "/=") {
      throw new Error("A bitwise compound operation cannot be printed without sealed numeric evidence.");
    }
    return Object.freeze({ kind: "binary", operator: operator.slice(0, -1), left, right });
  }
  const value = planMojoNumericValue(selection.operation, left, right, context);
  return selection.writeConversion === undefined ? value : planMojoNumericConversion(value, selection.writeConversion, context);
}

export function mojoCompoundRightType(
  node: Node,
  writeType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoTargetTypeRef {
  const selection = context.program.queries.intrinsicExpressionSelection(node);
  if (selection?.kind !== "numeric") return writeType;
  const type = selection.right === undefined ? undefined : context.program.queries.expressionType(selection.right);
  if (type === undefined) throw new Error("A sealed compound numeric operation must have an exact right operand carrier.");
  return type;
}
