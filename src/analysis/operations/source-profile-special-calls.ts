import type { ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoCallAnalysis, MojoCallAnalysisContext } from "./calls.js";
import { analyzeArguments } from "./call-arguments.js";
import { selectMojoJsonValueConversion } from "../conversions/json-values.js";
import { selectMojoSourceProfileCallback } from "./source-profile-callbacks.js";
import {
  mojoDynamicTargetType,
  mojoNamedTargetType,
  mojoPrimitiveTargetType,
} from "../../target-model/types/constructors.js";

export function analyzeMojoObjectAssign(
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  if (sourceCall.optionalChain || sourceCall.sourceArguments.length !== 2) {
    return unsupported(
      "MOJO_OBJECT_ASSIGN_CALL_FORM_UNSUPPORTED",
      "Object.assign requires one non-optional call with exactly one target and one source object.",
    );
  }
  const targetExpression = sourceCall.sourceArguments[0]?.expression;
  const sourceExpression = sourceCall.sourceArguments[1]?.expression;
  const targetType = targetExpression === undefined
    ? undefined
    : context.expressionTypes.get(targetExpression);
  const sourceType = sourceExpression === undefined
    ? undefined
    : context.expressionTypes.get(sourceExpression);
  const targetDefinition = context.structuralObjects.definitionForType(targetType);
  const sourceDefinition = context.structuralObjects.definitionForType(sourceType);
  if (targetExpression === undefined || sourceExpression === undefined ||
    targetType === undefined || sourceType === undefined ||
    targetDefinition === undefined || sourceDefinition === undefined) {
    return unsupported(
      "MOJO_OBJECT_ASSIGN_SHAPE_NOT_CLOSED",
      "Object.assign requires exact generated structural-object target and source carriers.",
    );
  }
  const fields: Extract<
    import("../program/model.js").MojoCallSelection,
    { readonly kind: "object-assign" }
  >["fields"][number][] = [];
  for (const [sourceStorageIndex, sourceField] of sourceDefinition.fields.entries()) {
    const candidates = targetDefinition.fields
      .map((field, targetStorageIndex) => Object.freeze({ field, targetStorageIndex }))
      .filter(({ field }) => field.sourceName === sourceField.sourceName);
    const targetField = candidates.length === 1 ? candidates[0] : undefined;
    if (sourceField.optional || targetField === undefined || targetField.field.optional ||
      targetField.field.readonly) {
      return unsupported(
        "MOJO_OBJECT_ASSIGN_FIELD_RELATION_UNPROVEN",
        `Object.assign source field '${sourceField.sourceName}' has no unique writable required target field.`,
      );
    }
    const conversion = classifyMojoValueConversion(
      sourceField.type,
      targetField.field.type,
      undefined,
      context.projectRelationships,
    );
    if (conversion.kind === "unsupported") {
      return unsupported(
        "MOJO_OBJECT_ASSIGN_FIELD_CONVERSION_UNPROVEN",
        `Object.assign source field '${sourceField.sourceName}' cannot initialize its exact target field: ${conversion.reason}.`,
      );
    }
    fields.push(Object.freeze({
      sourceName: sourceField.sourceName,
      sourceStorageIndex,
      targetStorageIndex: targetField.targetStorageIndex,
      sourceType: sourceField.type,
      targetType: targetField.field.type,
      conversion: conversion.conversion,
    }));
  }
  const arguments_ = analyzeArguments(
    context.source.ast,
    sourceCall,
    Object.freeze([targetType, sourceType]),
    Object.freeze([
      Object.freeze({ convention: "imm" as const, position: "positional-or-keyword" as const, passing: "plain" as const }),
      Object.freeze({ convention: "imm" as const, position: "positional-or-keyword" as const, passing: "plain" as const }),
    ]),
    resolve,
    context.expressionTypes,
    context.valueRefinements,
    context.lifecycle,
    context.valueOwnership,
    new Map([
      [0, Object.freeze({ kind: "identity" as const })],
      [1, Object.freeze({ kind: "identity" as const })],
    ]),
    undefined,
    context.projectRelationships,
    context.contextualizeCallableArgument,
  );
  if (arguments_.kind === "unsupported") return arguments_;
  return Object.freeze({
    kind: "resolved",
    selection: Object.freeze({
      kind: "object-assign",
      target: targetExpression,
      source: sourceExpression,
      targetType,
      sourceType,
      arguments: arguments_.arguments,
      fields: Object.freeze(fields),
      resultType: targetType,
      optionalChain: false,
    }),
  });
}

export function analyzeMojoJsonStringify(
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  if (sourceCall.optionalChain || sourceCall.sourceArguments.length < 1 ||
    sourceCall.sourceArguments.length > 3) {
    return unsupported(
      "MOJO_JSON_STRINGIFY_CALL_FORM_UNSUPPORTED",
      "JSON.stringify requires one non-optional call with one through three arguments.",
    );
  }
  const valueArgument = sourceCall.sourceArguments[0];
  const valueType = valueArgument === undefined
    ? undefined
    : context.expressionTypes.get(valueArgument.expression) ?? resolve(valueArgument.type);
  if (valueArgument === undefined || valueType === undefined) {
    return unsupported(
      "MOJO_JSON_STRINGIFY_VALUE_NOT_CLOSED",
      "JSON.stringify requires one exact source value carrier.",
    );
  }
  const valueConversion = selectMojoJsonValueConversion(valueType, {
    source: context.source,
    structuralObjects: context.structuralObjects,
    projectRelationships: context.projectRelationships,
    lifecycle: context.lifecycle,
    callableByDeclaration: context.callableByDeclaration,
  });
  if (valueConversion.kind === "unsupported") {
    return unsupported(
      "MOJO_JSON_STRINGIFY_VALUE_UNSUPPORTED",
      valueConversion.reason,
    );
  }
  const undefinedType = Object.freeze({ kind: "undefined" as const });
  const parameterTypes: MojoTargetTypeRef[] = [mojoDynamicTargetType("js"), undefinedType, undefinedType];
  const conversionOverrides = new Map<number, import("../../target-model/conversions/model.js").MojoValueConversion>([
    [0, valueConversion.conversion],
  ]);
  let replacer: "none" | "callable" = "none";
  const replacerArgument = sourceCall.sourceArguments[1];
  if (replacerArgument !== undefined) {
    const replacerType = context.expressionTypes.get(replacerArgument.expression) ??
      resolve(replacerArgument.type);
    if (replacerType?.kind === "callable") {
      const selected = selectMojoSourceProfileCallback(Object.freeze({
        parameterIndex: 1,
        result: "preserve",
        errorMode: "native",
        variants: Object.freeze([Object.freeze({ arity: 2, targetName: "json_stringify_with_replacer" })]),
      }), sourceCall, resolve, context.expressionTypes);
      if (selected.kind === "unsupported") return selected;
      replacer = "callable";
      parameterTypes[1] = selected.type;
      if (selected.conversion !== undefined) conversionOverrides.set(1, selected.conversion);
    } else if (replacerType?.kind === "null" || replacerType?.kind === "undefined") {
      parameterTypes[1] = replacerType;
      conversionOverrides.set(1, Object.freeze({ kind: "identity" }));
    } else {
      return unsupported(
        "MOJO_JSON_STRINGIFY_REPLACER_UNSUPPORTED",
        "JSON.stringify supports an exact two-parameter replacer callback, null, undefined, or omission.",
      );
    }
  }
  let space: "none" | "number" | "string" = "none";
  const spaceArgument = sourceCall.sourceArguments[2];
  if (spaceArgument !== undefined) {
    const sourceType = context.expressionTypes.get(spaceArgument.expression) ?? resolve(spaceArgument.type);
    if (sourceType?.kind === "source-primitive" && sourceType.name === "float64") {
      space = "number";
      parameterTypes[2] = mojoPrimitiveTargetType("float64");
      conversionOverrides.set(2, Object.freeze({ kind: "identity" }));
    } else if (sourceType?.kind === "native-string" ||
      sourceType?.kind === "target-named" && sourceType.id === "tsonic.mojo.js.JsString") {
      space = "string";
      const targetType = mojoNamedTargetType("tsonic.mojo.js.JsString", ["tsonic_js"], "JsString");
      const conversion = classifyMojoValueConversion(
        sourceType,
        targetType,
        undefined,
        context.projectRelationships,
      );
      if (conversion.kind === "unsupported") {
        return unsupported("MOJO_JSON_STRINGIFY_SPACE_CONVERSION_UNPROVEN", conversion.reason);
      }
      parameterTypes[2] = targetType;
      conversionOverrides.set(2, conversion.conversion);
    } else if (sourceType?.kind === "undefined") {
      parameterTypes[2] = sourceType;
      conversionOverrides.set(2, Object.freeze({ kind: "identity" }));
    } else {
      return unsupported(
        "MOJO_JSON_STRINGIFY_SPACE_UNSUPPORTED",
        "JSON.stringify spacing requires an exact number, string, undefined, or omission.",
      );
    }
  }
  const arguments_ = analyzeArguments(
    context.source.ast,
    sourceCall,
    Object.freeze(parameterTypes),
    Object.freeze(parameterTypes.map((_, parameterIndex) => Object.freeze({
      convention: "imm" as const,
      position: "positional-or-keyword" as const,
      passing: "plain" as const,
      ...(parameterIndex === 1 && replacer === "callable"
        ? { callableConsumption: "retained" as const }
        : {}),
    }))),
    resolve,
    context.expressionTypes,
    context.valueRefinements,
    context.lifecycle,
    context.valueOwnership,
    conversionOverrides,
    undefined,
    context.projectRelationships,
    context.contextualizeCallableArgument,
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const resultType = resolve(sourceCall.sourceResultType);
  const jsStringType = mojoNamedTargetType("tsonic.mojo.js.JsString", ["tsonic_js"], "JsString");
  const runtimeResultType = Object.freeze({ kind: "optional" as const, value: jsStringType });
  const resultConversion = resultType === undefined
    ? undefined
    : classifyMojoValueConversion(
        runtimeResultType,
        resultType,
        undefined,
        context.projectRelationships,
      );
  if (resultType === undefined || resultConversion?.kind !== "resolved") {
    return unsupported(
      "MOJO_JSON_STRINGIFY_RESULT_NOT_CLOSED",
      resultConversion?.kind === "unsupported"
        ? resultConversion.reason
        : "JSON.stringify has no exact selected source result carrier.",
    );
  }
  return Object.freeze({
    kind: "resolved",
    selection: Object.freeze({
      kind: "json-stringify",
      arguments: arguments_.arguments,
      replacer,
      space,
      runtimeResultType,
      resultType,
      resultConversion: resultConversion.conversion,
      optionalChain: false,
    }),
  });
}

function unsupported(code: string, reason: string): MojoCallAnalysis {
  return Object.freeze({ kind: "unsupported", code, reason });
}
