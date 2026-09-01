import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoAnalyzedCallArgument } from "../program/model.js";

export interface MojoCallArgumentTarget {
  readonly convention: "imm" | "mut" | "var" | "ref" | "out" | "deinit";
  readonly position: "positional" | "positional-or-keyword" | "keyword";
  readonly nativeName?: string;
  readonly variadic?: boolean;
  readonly variadicCollectionType?: MojoTargetTypeRef;
  readonly passing?: "plain" | "consume";
}

export function restCallableElementType(
  type: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  if (type.kind === "list") return type.element;
  if (type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray") {
    const argument = type.genericArguments?.[0];
    return argument?.kind === "type" ? argument.type : undefined;
  }
  return undefined;
}

export function analyzeArguments(
  sourceCall: ResolvedSourceCallInfo,
  parameterTypes: readonly MojoTargetTypeRef[],
  targetArguments: readonly MojoCallArgumentTarget[],
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  conversionOverrides?: ReadonlyMap<number, MojoValueConversion>,
  contextualAggregate?: (expression: Node, targetType: MojoTargetTypeRef) => boolean,
): { readonly kind: "resolved"; readonly arguments: readonly MojoAnalyzedCallArgument[] } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  if (parameterTypes.length !== targetArguments.length) {
    return {
      kind: "unsupported",
      code: "MOJO_CALL_ABI_MISMATCH",
      reason: "Selected call parameter carriers and target argument ABI have different arities.",
    };
  }
  const arguments_: MojoAnalyzedCallArgument[] = [];
  for (const [sourceArgumentIndex, sourceArgument] of sourceCall.sourceArguments.entries()) {
    const bindings = sourceCall.sourceArgumentBindings.filter((binding) =>
      binding.sourceArgumentIndex === sourceArgumentIndex);
    if (bindings.length === 0) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_BINDING_MISSING",
        reason: `Source call argument ${sourceArgumentIndex} has no exact selected parameter binding.`,
      };
    }
    const parameterIndex = bindings[0]!.sourceParameterIndex;
    if (bindings.some((binding) => binding.sourceParameterIndex !== parameterIndex)) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_EXPANSION_UNSUPPORTED",
        reason: `Source call argument ${sourceArgumentIndex} expands across multiple target parameters.`,
      };
    }
    const spread = bindings.some((binding) => binding.sourceForm !== "value");
    const parameterType = spread
      ? targetArguments[parameterIndex]?.variadicCollectionType ?? parameterTypes[parameterIndex]
      : parameterTypes[parameterIndex];
    const target = targetArguments[parameterIndex];
    const selectedSourceType = expressionTypes.get(sourceArgument.expression) ??
      resolve(bindings[0]!.selectedArgumentType);
    const sourceType = selectedSourceType ??
      (parameterType !== undefined && contextualAggregate?.(sourceArgument.expression, parameterType)
        ? parameterType
        : undefined);
    if (selectedSourceType === undefined && sourceType !== undefined) {
      expressionTypes.set(sourceArgument.expression, sourceType);
    }
    if (parameterType === undefined || target === undefined || sourceType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_CARRIER_NOT_CLOSED",
        reason: `Source call argument ${sourceArgumentIndex} has no closed Mojo argument contract.`,
      };
    }
    if (spread && target.variadic !== true) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_SPREAD_UNSUPPORTED",
        reason: `Source call argument ${sourceArgumentIndex} spreads into a non-variadic Mojo parameter.`,
      };
    }
    const overriddenConversion = conversionOverrides?.get(parameterIndex);
    const conversion = overriddenConversion === undefined
      ? classifyMojoValueConversion(sourceType, parameterType)
      : { kind: "resolved" as const, conversion: overriddenConversion };
    if (conversion.kind === "unsupported") {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_CONVERSION_UNPROVEN",
        reason: conversion.reason,
      };
    }
    arguments_.push(Object.freeze({
      expression: sourceArgument.expression,
      sourceType,
      parameterType,
      conversion: conversion.conversion,
      passing: target.passing ??
        (target.convention === "var" || target.convention === "deinit" ? "consume" : "plain"),
      spread,
      position: target.position,
      parameterIndex,
      ...(target.position === "keyword" && target.nativeName !== undefined
        ? { nativeName: target.nativeName }
        : {}),
    }));
  }
  return { kind: "resolved", arguments: Object.freeze(arguments_) };
}

export function closeResultConversion(
  targetResult: MojoTargetTypeRef,
  sourceResult: Type,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
): { readonly kind: "resolved"; readonly conversion: MojoValueConversion } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const sourceCarrier = resolve(sourceResult);
  if (sourceCarrier === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_CALL_RESULT_CARRIER_NOT_CLOSED",
      reason: "Selected source call result has no closed Mojo carrier.",
    };
  }
  const conversion = sourceFutureShapeMatches(targetResult, sourceCarrier)
    ? { kind: "resolved" as const, conversion: Object.freeze({ kind: "identity" as const }) }
    : classifyMojoValueConversion(targetResult, sourceCarrier);
  return conversion.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_CALL_RESULT_CONVERSION_UNPROVEN", reason: conversion.reason }
    : { kind: "resolved", conversion: conversion.conversion };
}

function sourceFutureShapeMatches(
  target: MojoTargetTypeRef,
  source: MojoTargetTypeRef,
): boolean {
  return target.kind === "future" && source.kind === "future" &&
    target.domain === source.domain &&
    mojoTargetTypeEquals(target.output, source.output);
}
