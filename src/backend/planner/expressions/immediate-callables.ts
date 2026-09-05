import type { Node } from "@tsonic/tsts";
import type { MojoAnalyzedCallArgument } from "../../../analysis/program/model.js";
import type { MojoCallableDisposition } from "../../../analysis/representations/model.js";
import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type {
  MojoTargetCallableParameter,
  MojoTargetTypeRef,
} from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoCallableExpression } from "./callables.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoImmediateCallable(
  argument: MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  if (argument.sourceForm !== "value") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_IMMEDIATE_CALLBACK_SOURCE_FORM_CONFLICT",
      "An immediate native callback requires one exact authored callable value.",
      argument.expression,
    );
    return undefined;
  }
  const targetType = targetCallableType(argument);
  if (targetType === undefined || argument.sourceType.kind !== "callable") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_IMMEDIATE_CALLBACK_CONTRACT_MISSING",
      "An immediate native callback requires aligned source and target callable contracts.",
      argument.expression,
    );
    return undefined;
  }
  const disposition = context.program.representations.callable(argument.expression);
  if (disposition === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_IMMEDIATE_CALLBACK_DISPOSITION_MISSING",
      "An immediate native callback has no sealed physical callable disposition.",
      argument.expression,
    );
    return undefined;
  }
  for (const parameter of targetType.parameters) registerMojoTypeImports(parameter.type, context);
  registerMojoTypeImports(targetType.result, context);
  if (targetType.errorType !== undefined) registerMojoTypeImports(targetType.errorType, context);

  const ast = context.program.source.ast;
  const inline = ast.is.IsArrowFunction(argument.expression) ||
    ast.is.IsFunctionExpression(argument.expression);
  if (inline && disposition.kind !== "erased" &&
    argument.conversion.kind === "callable-adapt") {
    return planMojoCallableExpression(
      argument.expression,
      context,
      planValue,
      targetType,
    );
  }

  const source = planValue(argument.expression, context);
  if (source === undefined) return undefined;
  if (canPassDirectly(argument.conversion, disposition)) return source;
  return wrapImmediateCallable(
    argument.expression,
    source,
    argument.sourceType,
    targetType,
    argument.conversion,
    disposition,
    context,
  );
}

function targetCallableType(
  argument: MojoAnalyzedCallArgument,
): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> | undefined {
  if (argument.conversion.kind === "callable-adapt" ||
    argument.conversion.kind === "js-callback-truthiness") {
    return argument.conversion.targetType.kind === "callable"
      ? argument.conversion.targetType
      : undefined;
  }
  return argument.conversion.kind === "identity" && argument.parameterType.kind === "callable"
    ? argument.parameterType
    : undefined;
}

function canPassDirectly(
  conversion: MojoValueConversion,
  disposition: MojoCallableDisposition,
): boolean {
  if (disposition.kind === "erased") return false;
  return conversion.kind === "identity" ||
    (conversion.kind === "callable-adapt" && conversion.result === "preserve" &&
      conversion.error === "preserve");
}

function wrapImmediateCallable(
  node: Node,
  source: MojoValuePlan,
  sourceType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  conversion: MojoValueConversion,
  disposition: MojoCallableDisposition,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (sourceType.parameters.length !== targetType.parameters.length) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_IMMEDIATE_CALLBACK_ARITY_CONFLICT",
      "An immediate callback adapter requires identical sealed source and target arities.",
      node,
    );
    return undefined;
  }
  const callbackName = allocateMojoSyntheticName(context, "immediate_callback");
  const parameterNames = targetType.parameters.map((_, index) =>
    allocateMojoSyntheticName(context, `callback_argument_${index + 1}`));
  const forwarded = sourceType.parameters.map((parameter, index) =>
    forwardCallbackParameter(parameter, parameterNames[index]!, disposition.kind === "erased", node, context));
  if (forwarded.some((value) => value === undefined)) return undefined;
  const sourceCall: MojoExpression = disposition.kind === "erased"
    ? Object.freeze({
        kind: "method-call",
        receiver: Object.freeze({ kind: "path", path: callbackName }),
        name: "call",
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "tuple",
            elements: Object.freeze(forwarded as readonly MojoExpression[]),
          }),
        })]),
      })
    : Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: callbackName }),
        arguments: Object.freeze((forwarded as readonly MojoExpression[]).map((value) =>
          Object.freeze({ value }))),
      });
  const result = convertImmediateCallbackResult(
    sourceCall,
    conversion,
    targetType,
    context,
  );
  if (result === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_IMMEDIATE_CALLBACK_RESULT_CONVERSION_MISSING",
      "An immediate callback requires one exact expression-level result conversion.",
      node,
    );
    return undefined;
  }
  return withMojoValue(Object.freeze([
    ...source.before,
    Object.freeze({
      kind: "variable" as const,
      name: callbackName,
      initializer: source.value,
    }),
  ]), Object.freeze({
    kind: "lambda",
    parameters: Object.freeze(targetType.parameters.map((parameter, index) => Object.freeze({
      name: parameterNames[index]!,
      type: parameter.type,
      convention: parameter.convention,
    }))),
    captures: Object.freeze([Object.freeze({ name: callbackName, convention: "imm" as const })]),
    resultType: targetType.result,
    raises: targetType.raises,
    ...(targetType.errorType === undefined ? {} : { errorType: targetType.errorType }),
    expression: result,
  }));
}

function forwardCallbackParameter(
  parameter: MojoTargetCallableParameter,
  name: string,
  intoErasedTuple: boolean,
  node: Node,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const value: MojoExpression = Object.freeze({ kind: "path", path: name });
  if (parameter.passing === "consume" || parameter.convention === "var" ||
    parameter.convention === "deinit") {
    return consumeMojoValue(value, parameter.type, context.program.lifecycle);
  }
  if (!intoErasedTuple) return value;
  const copy = context.program.lifecycle.capabilities(parameter.type).copy;
  if (copy === "implicit") return value;
  if (copy === "explicit") return Object.freeze({ kind: "copy", expression: value });
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_IMMEDIATE_ERASED_CALLBACK_ARGUMENT_COPY_MISSING",
    "An erased callback invoked through an immediate adapter requires copyable value arguments.",
    node,
  );
  return undefined;
}

function convertImmediateCallbackResult(
  expression: MojoExpression,
  conversion: MojoValueConversion,
  targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (conversion.kind === "identity" || conversion.kind === "callable-adapt") {
    return targetType.result.kind !== "unit"
      ? expression
      : Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            ["tsonic_runtime"],
            "discard_callable_result",
          ),
          arguments: Object.freeze([Object.freeze({ value: expression })]),
        });
  }
  if (conversion.kind !== "js-callback-truthiness") return undefined;
  switch (conversion.source) {
    case "number":
      return Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_truthy_number"),
        arguments: Object.freeze([Object.freeze({ value: expression })]),
      });
    case "string":
    case "native-string":
      return Object.freeze({
        kind: "binary",
        operator: "!=",
        left: Object.freeze({
          kind: "call",
          callee: Object.freeze({ kind: "path", path: "len" }),
          arguments: Object.freeze([Object.freeze({ value: expression })]),
        }),
        right: Object.freeze({ kind: "number-literal", text: "0" }),
      });
    case "dynamic":
      return Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(context, ["tsonic_js"], "js_truthy"),
        arguments: Object.freeze([Object.freeze({ value: expression })]),
      });
    case "always-true":
    case "always-false":
      return Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_js"],
          conversion.source === "always-true"
            ? "js_truthy_present_result"
            : "js_truthy_absent_result",
        ),
        arguments: Object.freeze([Object.freeze({ value: expression })]),
      });
  }
}
