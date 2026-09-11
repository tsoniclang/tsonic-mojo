import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { allocateMojoSyntheticName, mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { consumeMojoValue, mojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function adaptMojoCallableResult(
  expression: MojoExpression,
  conversion: Extract<MojoValueConversion, { readonly kind: "callable-adapt" }>,
  context: MojoPlanningContext,
  convert: (value: MojoValuePlan, conversion: MojoValueConversion, context: MojoPlanningContext) => MojoValuePlan | undefined,
): MojoExpression | undefined {
  if (conversion.result !== "convert") return expression;
  if (conversion.resultConversion === undefined || conversion.targetType.kind !== "callable") return undefined;
  const source = conversion.sourceType;
  const argumentsType: MojoTargetTypeRef = Object.freeze({ kind: "tuple", elements: Object.freeze(source.parameters.map((parameter) => parameter.type)) });
  const result = conversion.targetType.result;
  const error: MojoTargetTypeRef = source.errorType ?? Object.freeze({ kind: "target-named", id: "mojo.builtin.Error", modulePath: Object.freeze([]), name: "Error" });
  const types = [argumentsType, source.result, result, ...(source.raises ? [error] : [])];
  for (const type of types) registerMojoTypeImports(type, context);
  const name = allocateMojoSyntheticName(context, "callback_result");
  const selected = convert(mojoValue(consumeMojoValue(Object.freeze({ kind: "path", path: name }), source.result, context.program.lifecycle)), conversion.resultConversion, context);
  if (selected === undefined || selected.before.length !== 0) return undefined;
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], source.raises ? "adapt_raising_callable_result" : "adapt_callable_result"),
    genericArguments: Object.freeze(types.map((type) => Object.freeze({ kind: "type" as const, type }))),
    arguments: Object.freeze([
      Object.freeze({ value: expression }),
      Object.freeze({ value: Object.freeze({
        kind: "lambda", parameters: Object.freeze([Object.freeze({ name, type: source.result, convention: "var" })]),
        captures: Object.freeze([]), resultType: result, raises: false, expression: selected.value,
      }) }),
    ]),
  });
}
