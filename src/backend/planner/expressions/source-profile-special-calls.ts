import type { MojoCallSelection } from "../../../analysis/program/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  orderCallArguments,
  planSelectedArguments,
} from "./call-support.js";
import { convertMojoValue } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoObjectAssign(
  selection: Extract<MojoCallSelection, { readonly kind: "object-assign" }>,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const planned = planSelectedArguments(selection.arguments, context, planValue);
  if (planned === undefined) return undefined;
  const ordered = orderCallArguments(planned, context);
  const bySourceIndex = new Map(selection.arguments.map((argument, index) => [
    argument.sourceArgumentIndex,
    ordered.arguments[index]?.value,
  ] as const));
  const targetValue = bySourceIndex.get(0);
  const sourceValue = bySourceIndex.get(1);
  if (targetValue === undefined || sourceValue === undefined) return undefined;
  const before: MojoStatement[] = [...ordered.before];
  for (const field of selection.fields) {
    const sourceField = structuralField(sourceValue, field.sourceStorageIndex);
    const converted = convertMojoValue(mojoValue(sourceField), field.conversion, context);
    if (converted === undefined) return undefined;
    before.push(...converted.before, Object.freeze({
      kind: "assignment",
      operator: "=",
      left: structuralField(targetValue, field.targetStorageIndex),
      right: converted.value,
    }));
  }
  return withMojoValue(before, targetValue);
}

export function planMojoJsonStringify(
  selection: Extract<MojoCallSelection, { readonly kind: "json-stringify" }>,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const planned = planSelectedArguments(selection.arguments, context, planValue);
  if (planned === undefined) return undefined;
  const ordered = orderCallArguments(planned, context);
  const bySourceIndex = new Map(selection.arguments.map((argument, index) => [
    argument.sourceArgumentIndex,
    ordered.arguments[index]?.value,
  ] as const));
  const value = bySourceIndex.get(0);
  const replacer = selection.replacer === "callable" ? bySourceIndex.get(1) : undefined;
  const space = selection.space === "none" ? undefined : bySourceIndex.get(2);
  if (value === undefined || selection.replacer === "callable" && replacer === undefined ||
    selection.space !== "none" && space === undefined) return undefined;
  const name = selection.replacer === "callable"
    ? selection.space === "number"
      ? "json_stringify_with_replacer_and_space_number"
      : selection.space === "string"
        ? "json_stringify_with_replacer_and_space_string"
        : "json_stringify_with_replacer"
    : selection.space === "number"
      ? "json_stringify_with_space_number"
      : selection.space === "string"
        ? "json_stringify_with_space_string"
        : "json_stringify";
  const call = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_js"], name),
    arguments: Object.freeze([
      Object.freeze({ value }),
      ...(replacer === undefined ? [] : [Object.freeze({ value: replacer })]),
      ...(space === undefined ? [] : [Object.freeze({ value: space })]),
    ]),
  }) satisfies MojoExpression;
  return convertMojoValue(
    withMojoValue(ordered.before, call),
    selection.resultConversion,
    context,
  );
}

function structuralField(receiver: MojoExpression, storageIndex: number): MojoExpression {
  return Object.freeze({
    kind: "element",
    receiver: Object.freeze({
      kind: "postfix-deref",
      expression: Object.freeze({ kind: "member", receiver, name: "_state" }),
    }),
    index: Object.freeze({ kind: "number-literal", text: String(storageIndex) }),
  });
}
