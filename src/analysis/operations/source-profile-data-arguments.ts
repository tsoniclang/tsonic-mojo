import type { AstReader, Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoSourceProfileParameterContract } from "../../policy/operations/source-profile-selection.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { selectMojoDataValueConversion } from "../conversions/json-values.js";
import type { MojoCallAnalysisContext } from "./calls.js";
import type { MojoArgumentConversionMap, MojoSelectedArgumentBinding } from "./call-argument-conversions.js";
import type { MojoCallArgumentTarget } from "./call-arguments.js";
import { selectedMojoArgumentCarrier } from "./call-argument-carriers.js";
import { collectionShape } from "../../policy/conversions/javascript-conversions.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";

export function selectedSourceProfileArgumentType(
  ast: AstReader,
  parameterIndex: number,
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  const bindings = sourceCall.sourceArgumentBindings.filter((binding) =>
    binding.sourceParameterIndex === parameterIndex);
  if (bindings.length !== 1) return undefined;
  return selectedMojoArgumentCarrier(ast, sourceCall, bindings[0]!, expressionTypes, resolve)?.type;
}

export function sourceProfileDataArgumentConversions(
  contracts: readonly MojoSourceProfileParameterContract[],
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  targets: readonly MojoCallArgumentTarget[],
  context: MojoCallAnalysisContext,
):
  | { readonly kind: "resolved"; readonly conversions: MojoArgumentConversionMap }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const conversions = new Map<MojoSelectedArgumentBinding, MojoValueConversion>();
  for (const binding of sourceCall.sourceArgumentBindings) {
    const parameterIndex = binding.sourceParameterIndex;
    if (contracts[parameterIndex] !== "js-data") continue;
    const carrier = selectedMojoArgumentCarrier(
      context.source.ast, sourceCall, binding, context.expressionTypes, resolve,
    );
    if (carrier === undefined) return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_DATA_ARGUMENT_NOT_CLOSED",
      reason: `Source-profile data argument ${binding.effectiveArgumentIndex} has no exact selected carrier.`,
    };
    const sequence = binding.sourceForm === "spread-sequence";
    const collection = collectionShape(carrier.type);
    const elementType = collection?.element ??
      (carrier.type.kind === "fixed-array" ? carrier.type.element : undefined);
    const sourceType = sequence ? elementType : carrier.type;
    const targetType = targets[parameterIndex]?.variadicCollectionType;
    const jsValueType = Object.freeze({ kind: "dynamic" as const, domain: "js" as const });
    if (sourceType === undefined || sequence && (targetType?.kind !== "list" ||
      !mojoTargetTypeEquals(targetType.element, jsValueType))) return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_DATA_SPREAD_NOT_CLOSED",
      reason: "A data rest spread requires an exact homogeneous source and native JsValue list ABI.",
    };
    const conversion = selectMojoDataValueConversion(sourceType, {
      source: context.source,
      structuralObjects: context.structuralObjects,
      projectRelationships: context.projectRelationships,
      lifecycle: context.lifecycle,
      callableByDeclaration: context.callableByDeclaration,
    });
    if (conversion.kind === "unsupported") return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_DATA_ARGUMENT_NOT_CLOSED",
      reason: conversion.reason,
    };
    conversions.set(binding, sequence
      ? Object.freeze({
          kind: "js-data-rest",
          sourceType: carrier.type,
          targetType: targetType as Extract<MojoTargetTypeRef, { readonly kind: "list" }>,
          source: collection?.kind === "js-array" ? "js-array" : "sequence",
          elementType: sourceType,
          elementConversion: conversion.conversion,
        })
      : conversion.conversion);
  }
  return Object.freeze({ kind: "resolved", conversions });
}
