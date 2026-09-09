import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { allocateMojoSyntheticName, mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import type { MojoNestedValueConverter } from "./conversion-support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function convertMojoDataRest(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "js-data-rest" }>,
  context: MojoPlanningContext,
  convert: MojoNestedValueConverter,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "spread_source");
  const resultName = allocateMojoSyntheticName(context, "spread_values");
  const indexName = allocateMojoSyntheticName(context, "spread_index");
  const source = path(sourceName);
  const result = path(resultName);
  const index = path(indexName);
  const optionalName = allocateMojoSyntheticName(context, "spread_slot");
  const optional = path(optionalName);
  const converted = convert(mojoValue(conversion.source === "js-array"
    ? method(optional, "value")
    : Object.freeze({ kind: "element", receiver: source, index })), conversion.elementConversion, context);
  if (converted === undefined) return undefined;
  const appendValue = Object.freeze([
    ...converted.before,
    append(result, converted.value),
  ]);
  const statements: readonly MojoStatement[] = conversion.source === "js-array"
    ? Object.freeze([
        Object.freeze({
          kind: "variable", name: optionalName,
          initializer: method(source, "get", [index]),
        }),
        Object.freeze({
          kind: "if", condition: optional, thenStatements: appendValue,
          elseStatements: Object.freeze([append(result, Object.freeze({
            kind: "call",
            callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_value_from_undefined"),
            arguments: Object.freeze([]),
          }))]),
        }),
      ])
    : appendValue;
  return withMojoValue(Object.freeze([
    ...plan.before,
    Object.freeze({
      kind: "variable", name: sourceName, type: conversion.sourceType,
      initializer: plan.value,
    }),
    Object.freeze({
      kind: "variable", name: resultName, type: conversion.targetType,
      initializer: Object.freeze({
        kind: "construct", type: conversion.targetType, arguments: Object.freeze([]),
      }),
    }),
    Object.freeze({
      kind: "for", binding: indexName,
      iterable: Object.freeze({
        kind: "call", callee: path("range"), arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "call", callee: path("len"), arguments: Object.freeze([{ value: source }]),
          }),
        })]),
      }),
      statements,
    }),
  ]), result);
}

function path(name: string): MojoExpression {
  return Object.freeze({ kind: "path", path: name });
}

function method(receiver: MojoExpression, name: string, values: readonly MojoExpression[] = []): MojoExpression {
  return Object.freeze({
    kind: "method-call", receiver, name,
    arguments: Object.freeze(values.map((value) => Object.freeze({ value }))),
  });
}

function append(receiver: MojoExpression, value: MojoExpression): MojoStatement {
  return Object.freeze({ kind: "expression", expression: method(receiver, "append", [value]) });
}
