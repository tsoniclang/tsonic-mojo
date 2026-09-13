import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import { allocateMojoSyntheticName, mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function adaptMojoCallableArguments(
  expression: MojoExpression,
  conversion: Extract<MojoValueConversion, { readonly kind: "callable-adapt" }>,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (conversion.parameters.kind === "identity") return expression;
  const target = conversion.targetType;
  if (target.kind !== "callable") return undefined;
  const sourceArguments: MojoTargetTypeRef = Object.freeze({
    kind: "tuple", elements: Object.freeze(conversion.sourceType.parameters.map((parameter) => parameter.type)),
  });
  const targetArguments: MojoTargetTypeRef = Object.freeze({
    kind: "tuple", elements: Object.freeze(target.parameters.map((parameter) => parameter.type)),
  });
  const error: MojoTargetTypeRef = target.errorType ?? Object.freeze({
    kind: "target-named", id: "mojo.builtin.Error", modulePath: Object.freeze([]), name: "Error",
  });
  const result: MojoTargetTypeRef = target.result.kind === "unit" ? Object.freeze({
    kind: "target-named", id: "mojo.builtin.NoneType", modulePath: Object.freeze([]), name: "NoneType",
  }) : target.result;
  for (const type of [sourceArguments, targetArguments, result, ...(target.raises ? [error] : [])]) {
    registerMojoTypeImports(type, context);
  }
  const name = allocateMojoSyntheticName(context, "callback_arguments");
  const elements = conversion.parameters.copies.map((copy, index): MojoExpression => {
    const value: MojoExpression = Object.freeze({
      kind: "element", receiver: Object.freeze({ kind: "path", path: name }),
      index: Object.freeze({ kind: "number-literal", text: String(index) }),
    });
    return copy === "explicit" ? Object.freeze({ kind: "copy", expression: value }) : value;
  });
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], target.raises ?
      "adapt_raising_callable_arguments" : "adapt_callable_arguments"),
    genericArguments: Object.freeze([sourceArguments, targetArguments, result, ...(target.raises ? [error] : [])]
      .map((type) => Object.freeze({ kind: "type" as const, type }))),
    arguments: Object.freeze([
      Object.freeze({ value: expression }),
      Object.freeze({ value: Object.freeze({
        kind: "lambda", parameters: Object.freeze([Object.freeze({ name, type: targetArguments, convention: "var" })]),
        captures: Object.freeze([]), resultType: sourceArguments, raises: false,
        expression: Object.freeze({ kind: "tuple", elements: Object.freeze(elements) }),
      }) }),
    ]),
  });
}
