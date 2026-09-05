import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "../../../analysis/program/model.js";
import {
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

type MojoIntrinsicCallSelection = Extract<
  MojoCallSelection,
  {
    readonly kind:
      | "source-intrinsic"
      | "explicit-safety"
      | "native-pointer"
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
  if (selection.operation === "bind") {
    const identity = planValue(selection.identityExpression, context, selection.identityType);
    const state = context.program.queries.projectState(selection.identityType);
    return identity === undefined
      ? undefined
      : withMojoValue(identity.before, Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            ["tsonic_runtime"],
            state?.storage === "erased"
              ? "raw_pointer_from_shared_reference"
              : "raw_pointer_from_arc",
          ),
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "member", receiver: identity.value, name: "_state" }),
          })]),
        }));
  }
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
  registerMojoTypeImports(selection.locationType, context);
  switch (selection.operation) {
    case "address-of": {
      const storage = context.program.queries.locationStorage(selection.storageDeclaration);
      if (storage === undefined) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_POINTER_STORAGE_PLAN_MISSING",
          "Address-of has no sealed promoted Mojo storage.",
          node,
        );
        return undefined;
      }
      return mojoValue(Object.freeze({ kind: "path", path: storage.name }));
    }
    case "allocate": {
      const initial = planValue(selection.initialExpression, context, selection.pointeeType);
      return initial === undefined
        ? undefined
        : withMojoValue(initial.before, Object.freeze({
            kind: "construct",
            type: selection.locationType,
            arguments: Object.freeze([Object.freeze({ value: initial.value })]),
          }));
    }
    case "load": {
      const pointer = planValue(selection.pointerExpression, context, selection.locationType);
      return pointer === undefined
        ? undefined
        : withMojoValue(pointer.before, Object.freeze({
            kind: "method-call",
            receiver: pointer.value,
            name: "read",
            arguments: Object.freeze([]),
          }));
    }
    case "store": {
      const pointer = planValue(selection.pointerExpression, context, selection.locationType);
      const value = planValue(selection.valueExpression, context, selection.pointeeType);
      if (pointer === undefined || value === undefined) return undefined;
      const ordered = orderMojoValues([
        Object.freeze({ plan: pointer, type: selection.locationType, role: "location_pointer" }),
        Object.freeze({ plan: value, type: selection.pointeeType, role: "location_value" }),
      ], context);
      return withMojoValue(ordered.before, Object.freeze({
        kind: "method-call",
        receiver: ordered.values[0]!,
        name: "write",
        arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
      }));
    }
    case "equal-pointer": {
      const left = planValue(selection.leftExpression, context, selection.operandType);
      const right = planValue(selection.rightExpression, context, selection.operandType);
      if (left === undefined || right === undefined) return undefined;
      const ordered = orderMojoValues([
        Object.freeze({ plan: left, type: selection.operandType, role: "location_left" }),
        Object.freeze({ plan: right, type: selection.operandType, role: "location_right" }),
      ], context);
      return withMojoValue(ordered.before, Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_runtime"],
          "equal_location",
        ),
        arguments: Object.freeze(ordered.values.map((value) => Object.freeze({ value }))),
      }));
    }
  }
}
  return undefined;
}
