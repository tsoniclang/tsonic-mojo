import type { MojoMemoryOperationSelection } from "../../../target-model/operations/native-memory.js";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { orderMojoLocationValues } from "./location-values.js";
import type { MojoValuePlanner } from "./support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoNativeLayoutChecks } from "./native-layout-checks.js";

export function planMojoNativeMemory(selection: MojoMemoryOperationSelection, context: MojoPlanningContext, planValue: MojoValuePlanner): MojoValuePlan | undefined {
  registerMojoTypeImports(selection.resultType, context);
  if (selection.operation === "observation") return mojoValue(construct(selection.resultType, Object.freeze({ kind: "number-literal", text: String(selection.value) })));
  const operand = planValue(selection.expression, context, selection.inputType);
  if (operand === undefined) return undefined;
  const invoke = (name: string, values: readonly MojoExpression[], parameters: readonly MojoTargetGenericArgument[]): MojoExpression => Object.freeze({
    kind: "call", callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], name),
    genericArguments: Object.freeze(parameters), arguments: Object.freeze(values.map((value) => Object.freeze({ value }))),
  });
  if (selection.operation === "keep-alive") return withMojoValue(operand.before, invoke("keep_alive", [operand.value], [{ kind: "type", type: selection.inputType }]));
  if (selection.operation === "reinterpret" || selection.operation === "to-raw") {
    const layout = selection.layout;
    registerMojoTypeImports(layout.type, context);
    return withMojoValue([...operand.before, ...planMojoNativeLayoutChecks(layout, context)], invoke(selection.operation === "reinterpret" ? "reinterpret_location" : "to_raw_location", [operand.value], [
      { kind: "type", type: layout.type }, integer(layout.byteSize), integer(layout.byteAlignment), integer(layout.stride), integer(layout.addressWidth),
      { kind: "boolean", value: layout.littleEndian },
    ]));
  }
  if (selection.operation === "byte-offset") {
    const offset = planValue(selection.offset, context, selection.offsetType);
    if (offset === undefined) return undefined;
    const ordered = orderMojoLocationValues([
      { plan: operand, type: selection.inputType, role: "raw_pointer" },
      { plan: offset, type: selection.offsetType, role: "raw_offset" },
    ], context);
    return withMojoValue(ordered.before, invoke(selection.signed ? "offset_raw_signed" : "offset_raw_unsigned", ordered.values, [integer(selection.addressWidth)]));
  }
  if (selection.operation === "raw-to-address-integer") {
    return withMojoValue(operand.before, construct(selection.resultType, invoke("raw_address", [operand.value], [integer(selection.addressWidth)])));
  }
  const addressType: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: "uint64" });
  registerMojoTypeImports(addressType, context);
  return withMojoValue(operand.before, invoke("raw_from_address", [construct(addressType, operand.value)], [integer(selection.addressWidth)]));
}

function integer(value: number): MojoTargetGenericArgument {
  return Object.freeze({ kind: "integer", value: String(value) });
}

function construct(type: MojoTargetTypeRef, value: MojoExpression): MojoExpression {
  return Object.freeze({ kind: "construct", type, arguments: Object.freeze([{ value }]) });
}
