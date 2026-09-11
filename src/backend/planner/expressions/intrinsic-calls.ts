import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "../../../analysis/program/model.js";
import {
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoTypedLocation } from "./typed-locations.js";
import { planMojoNativeMemory } from "./native-memory.js";

type MojoIntrinsicCallSelection = Extract<
  MojoCallSelection,
  {
    readonly kind:
      | "source-intrinsic"
      | "explicit-safety"
      | "native-pointer"
      | "native-memory"
      | "raw-pointer"
      | "typed-location";
  }
>;

export function planMojoIntrinsicCall(
  selection: MojoIntrinsicCallSelection,
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
if (selection.kind === "native-memory") return planMojoNativeMemory(selection, context, planValue);
if (selection.kind === "source-intrinsic") {
  if (selection.operation === "comptime-type") {
    return selection.value === undefined
      ? undefined
      : mojoValue(Object.freeze({ kind: "generic-argument-value", value: selection.value }));
  }
  if (selection.operand === undefined) return undefined;
  const operand = planValue(selection.operand, context, selection.resultType);
  if (operand === undefined) return undefined;
  switch (selection.operation) {
    case "comptime-value":
    case "comptime-condition":
      return withMojoValue(operand.before, Object.freeze({
        kind: "forced-comptime",
        expression: operand.value,
      }));
    case "comptime-iteration":
    case "write-only-reference":
    case "read-write-reference":
    case "read-only-reference":
    case "shared-borrow":
    case "mutable-borrow":
      return operand;
    case "js-string":
      registerMojoTypeImports(selection.resultType, context);
      return withMojoValue(operand.before, Object.freeze({
        kind: "construct",
        type: selection.resultType,
        arguments: Object.freeze([Object.freeze({ value: operand.value })]),
      }));
    case "copy":
      return withMojoValue(operand.before, Object.freeze({
        kind: "copy",
        expression: operand.value,
      }));
    case "materialize":
      return withMojoValue(operand.before, Object.freeze({
        kind: "materialize",
        expression: operand.value,
      }));
    case "move":
      return withMojoValue(
        operand.before,
        consumeMojoValue(
          operand.value,
          selection.resultType,
          context.program.lifecycle,
        ),
      );
  }
}
if (selection.kind === "explicit-safety") {
  return selection.form === "remaining-block"
    ? mojoValue(Object.freeze({ kind: "tuple", elements: Object.freeze([]) }))
    : planValue(selection.expression, context, selection.resultType);
}
if (selection.kind === "native-pointer") {
  registerMojoTypeImports(selection.pointerType, context);
  const pointer = planValue(selection.pointerExpression, context, selection.pointerType);
  if (pointer === undefined) return undefined;
  if (selection.operation === "load") {
    return withMojoValue(pointer.before, Object.freeze({
      kind: "postfix-deref",
      expression: pointer.value,
    }));
  }
  if (selection.operation === "offset") {
    const offset = planValue(selection.offsetExpression, context, selection.offsetType);
    if (offset === undefined) return undefined;
    const ordered = orderMojoValues([
      Object.freeze({ plan: pointer, type: selection.pointerType, role: "native_pointer" }),
      Object.freeze({ plan: offset, type: selection.offsetType, role: "native_pointer_offset" }),
    ], context);
    return withMojoValue(ordered.before, Object.freeze({
      kind: "method-call",
      receiver: ordered.values[0]!,
      name: "unsafe_offset",
      arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
    }));
  }
  const value = planValue(selection.valueExpression, context, selection.valueType);
  if (value === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: pointer, type: selection.pointerType, role: "native_pointer" }),
    Object.freeze({ plan: value, type: selection.valueType, role: "native_pointer_value" }),
  ], context);
  return withMojoValue(Object.freeze([
    ...ordered.before,
    Object.freeze({
      kind: "assignment" as const,
      left: Object.freeze({
        kind: "postfix-deref" as const,
        expression: ordered.values[0]!,
      }),
      operator: "=" as const,
      right: ordered.values[1]!,
    }),
  ]), Object.freeze({ kind: "tuple", elements: Object.freeze([]) }));
}
if (selection.kind === "raw-pointer") {
  if (selection.operation === "equal") {
    const left = planValue(selection.leftExpression, context, selection.leftType);
    const right = planValue(selection.rightExpression, context, selection.rightType);
    if (left === undefined || right === undefined) return undefined;
    const ordered = orderMojoValues([
      Object.freeze({ plan: left, type: selection.leftType, role: "raw_pointer_left" }),
      Object.freeze({ plan: right, type: selection.rightType, role: "raw_pointer_right" }),
    ], context);
    return withMojoValue(ordered.before, Object.freeze({
      kind: "call",
      callee: mojoModuleMemberExpression(
        context,
        ["tsonic_runtime"],
        "equal_raw_pointer",
      ),
      arguments: Object.freeze(ordered.values.map((value) => Object.freeze({ value }))),
    }));
  }
  const pointer = planValue(selection.pointerExpression, context, selection.pointerType);
  return pointer === undefined
    ? undefined
    : withMojoValue(pointer.before, Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_runtime"],
          "hash_raw_pointer",
        ),
        arguments: Object.freeze([Object.freeze({ value: pointer.value })]),
      }));
}
if (selection.kind === "typed-location") {
  return planMojoTypedLocation(selection, node, context, planValue);
}
  return undefined;
}
