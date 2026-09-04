import type { AstReader, Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoAnalyzedCallArgument } from "../program/model.js";
import type { MojoValueRefinementSelection } from "../refinements/model.js";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import type { MojoArgumentDisposition } from "../representations/model.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import type { MojoValueOwnership } from "../../target-model/lifecycle/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import { classifyMojoSourceResultConversion } from "./call-results.js";

export interface MojoCallArgumentTarget {
  readonly convention: "imm" | "mut" | "var" | "ref" | "out" | "deinit";
  readonly position: "positional" | "positional-or-keyword" | "keyword";
  readonly nativeName?: string;
  readonly variadic?: boolean;
  readonly variadicCollectionType?: MojoTargetTypeRef;
  readonly passing?: "plain" | "consume";
  readonly callableConsumption?: "immediate" | "retained";
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
  ast: AstReader,
  sourceCall: ResolvedSourceCallInfo,
  parameterTypes: readonly MojoTargetTypeRef[],
  targetArguments: readonly MojoCallArgumentTarget[],
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  valueRefinements: WeakMap<Node, MojoValueRefinementSelection>,
  lifecycle: MojoLifecycleResolver,
  valueOwnership: (expression: Node) => MojoValueOwnership,
  conversionOverrides?: ReadonlyMap<number, MojoValueConversion>,
  contextualAggregate?: (expression: Node, targetType: MojoTargetTypeRef) => boolean,
  projectRelationships?: MojoProjectTypeRelationships,
  contextualizeCallable?: (
    expression: Node,
    targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  ) => Extract<MojoTargetTypeRef, { readonly kind: "callable" }> | undefined,
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
    const bindings = sourceCall.sourceArgumentBindings
      .filter((binding) => binding.sourceArgumentIndex === sourceArgumentIndex)
      .sort((left, right) => left.effectiveArgumentIndex - right.effectiveArgumentIndex);
    if (bindings.length === 0) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_BINDING_MISSING",
        reason: `Source call argument ${sourceArgumentIndex} has no exact selected parameter binding.`,
      };
    }
    const hasSpread = bindings.some((binding) => binding.sourceForm !== "value");
    const sourceExpression = hasSpread
      ? Node_Expression(ast, sourceArgument.expression)
      : sourceArgument.expression;
    if (sourceExpression === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_SPREAD_OPERAND_MISSING",
        reason: `Spread call argument ${sourceArgumentIndex} has no exact operand expression.`,
      };
    }
    const sourceContainerType = hasSpread
      ? expressionTypes.get(sourceExpression) ??
        expressionTypes.get(sourceArgument.expression) ??
        resolve(sourceArgument.type)
      : undefined;
    if (hasSpread && sourceContainerType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_SPREAD_CARRIER_NOT_CLOSED",
        reason: `Spread call argument ${sourceArgumentIndex} has no exact aggregate carrier.`,
      };
    }
    if (sourceContainerType !== undefined) expressionTypes.set(sourceExpression, sourceContainerType);
    for (const binding of bindings) {
      const parameterIndex = binding.sourceParameterIndex;
      const target = targetArguments[parameterIndex];
      const spreadSequence = binding.sourceForm === "spread-sequence";
      const parameterType = spreadSequence
        ? target?.variadicCollectionType ?? parameterTypes[parameterIndex]
        : parameterTypes[parameterIndex];
      if (parameterType === undefined || target === undefined) {
        return {
          kind: "unsupported",
          code: "MOJO_CALL_ARGUMENT_CARRIER_NOT_CLOSED",
          reason: `Source call argument ${sourceArgumentIndex} has no closed Mojo parameter contract.`,
        };
      }
      if (spreadSequence && target.variadic !== true) {
        return {
          kind: "unsupported",
          code: "MOJO_CALL_ARGUMENT_SPREAD_UNSUPPORTED",
          reason: `Source call argument ${sourceArgumentIndex} supplies an open sequence to a non-variadic Mojo parameter.`,
        };
      }
      const selectedBindingType = resolve(binding.selectedArgumentType);
      const contextualCallableType = binding.sourceForm === "value" &&
          parameterType.kind === "callable"
        ? contextualizeCallable?.(sourceExpression, parameterType)
        : undefined;
      const selectedSourceType = binding.sourceForm === "spread-element"
        ? spreadElementType(sourceContainerType!, binding.spreadElementIndex) ?? selectedBindingType
        : binding.sourceForm === "spread-sequence"
          ? sourceContainerType
          : contextualCallableType ?? expressionTypes.get(sourceExpression) ?? selectedBindingType;
      const sourceType = selectedSourceType ??
        (binding.sourceForm === "value" &&
            contextualAggregate?.(sourceExpression, parameterType) === true
          ? parameterType
          : undefined);
      if (sourceType === undefined) {
        return {
          kind: "unsupported",
          code: "MOJO_CALL_ARGUMENT_CARRIER_NOT_CLOSED",
          reason: `Source call argument ${sourceArgumentIndex} has no closed Mojo input carrier.`,
        };
      }
      if (binding.sourceForm === "value" && expressionTypes.get(sourceExpression) === undefined) {
        expressionTypes.set(sourceExpression, sourceType);
      }
      const overriddenConversion = conversionOverrides?.get(parameterIndex);
      const conversion = overriddenConversion === undefined
        ? classifyMojoRefinedValueConversion(
            sourceType,
            parameterType,
            binding.sourceForm === "value"
              ? valueRefinements.get(sourceExpression)
              : undefined,
            projectRelationships,
          )
        : { kind: "resolved" as const, conversion: overriddenConversion };
      if (conversion.kind === "unsupported") {
        return {
          kind: "unsupported",
          code: "MOJO_CALL_ARGUMENT_CONVERSION_UNPROVEN",
          reason: conversion.reason,
        };
      }
      const disposition = analyzeMojoArgumentDisposition(
        sourceExpression,
        parameterType,
        target,
        conversion.conversion,
        lifecycle,
        valueOwnership,
      );
      if (disposition.kind === "unsupported") return disposition;
      arguments_.push(Object.freeze({
        expression: sourceExpression,
        sourceArgumentIndex,
        sourceForm: binding.sourceForm,
        ...(binding.spreadElementIndex === undefined
          ? {}
          : { spreadElementIndex: binding.spreadElementIndex }),
        ...(sourceContainerType === undefined ? {} : { sourceContainerType }),
        sourceType,
        parameterType,
        conversion: conversion.conversion,
        disposition: disposition.disposition,
        spread: spreadSequence,
        position: target.position,
        parameterIndex,
        ...(target.position === "keyword" && target.nativeName !== undefined
          ? { nativeName: target.nativeName }
          : {}),
        ...(target.callableConsumption === undefined
          ? {}
          : { callableConsumption: target.callableConsumption }),
      }));
    }
  }
  return { kind: "resolved", arguments: Object.freeze(arguments_) };
}

function spreadElementType(
  source: MojoTargetTypeRef,
  index: number | undefined,
): MojoTargetTypeRef | undefined {
  if (index === undefined) return undefined;
  if (source.kind === "tuple") return source.elements[index];
  if (source.kind === "fixed-array" || source.kind === "list") return source.element;
  return undefined;
}

export function analyzeMojoArgumentDisposition(
  expression: Node,
  type: MojoTargetTypeRef,
  target: MojoCallArgumentTarget,
  conversion: MojoValueConversion,
  lifecycle: MojoLifecycleResolver,
  valueOwnership: (expression: Node) => MojoValueOwnership,
): { readonly kind: "resolved"; readonly disposition: MojoArgumentDisposition } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const owned = target.passing === "consume" || target.convention === "var" ||
    target.convention === "deinit";
  if (!owned) {
    return Object.freeze({ kind: "resolved", disposition: Object.freeze({ kind: "plain" }) });
  }
  const capabilities = lifecycle.capabilities(type);
  const ownership = conversion.kind === "identity" ? valueOwnership(expression) : "fresh";
  if (ownership === "borrowed") {
    return Object.freeze({
      kind: "unsupported",
      code: "MOJO_OWNED_ARGUMENT_BORROWED",
      reason: "An owned Mojo parameter cannot consume a borrowed result; request an exact copy or materialization explicitly.",
    });
  }
  if (ownership === "fresh") {
    if (!capabilities.movable && capabilities.copy === "unavailable") {
      return Object.freeze({
        kind: "unsupported",
        code: "MOJO_FRESH_ARGUMENT_NOT_MOVABLE",
        reason: "A fresh Mojo value cannot initialize an owned parameter because its exact carrier is neither movable nor copyable.",
      });
    }
    return Object.freeze({ kind: "resolved", disposition: Object.freeze({ kind: "plain" }) });
  }
  if (capabilities.copy === "implicit") {
    return Object.freeze({ kind: "resolved", disposition: Object.freeze({ kind: "plain" }) });
  }
  return Object.freeze({
    kind: "unsupported",
    code: "MOJO_OWNED_ARGUMENT_TRANSFER_NOT_PROVEN",
    reason: capabilities.copy === "explicit"
      ? "An owned Mojo parameter requires copy(...) or move(...) because its stable source carrier is only explicitly copyable."
      : "An owned Mojo parameter requires move(...) because its stable source carrier is not copyable.",
  });
}

export function closeResultConversion(
  targetResult: MojoTargetTypeRef,
  sourceResult: Type,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  projectRelationships?: MojoProjectTypeRelationships,
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
    : classifyMojoSourceResultConversion(targetResult, sourceCarrier, projectRelationships);
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
