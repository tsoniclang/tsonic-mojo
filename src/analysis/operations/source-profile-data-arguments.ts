import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoSourceProfileParameterContract } from "../../policy/operations/source-profile-selection.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { selectMojoDataValueConversion } from "../conversions/json-values.js";
import type { MojoCallAnalysisContext } from "./calls.js";
import type { MojoArgumentConversionMap, MojoSelectedArgumentBinding } from "./call-argument-conversions.js";

export function selectedSourceProfileArgumentType(
  parameterIndex: number,
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  const bindings = sourceCall.sourceArgumentBindings.filter((binding) =>
    binding.sourceParameterIndex === parameterIndex);
  const argumentIndexes = [...new Set(bindings.map((binding) => binding.sourceArgumentIndex))];
  if (bindings.length === 0 || argumentIndexes.length !== 1) return undefined;
  const argument = sourceCall.sourceArguments[argumentIndexes[0]!];
  const selectedTypes = bindings.map((binding) => binding.selectedArgumentType);
  if (argument === undefined || selectedTypes.some((type) => type !== selectedTypes[0])) return undefined;
  return expressionTypes.get(argument.expression) ?? resolve(selectedTypes[0]!);
}

export function sourceProfileDataArgumentConversions(
  contracts: readonly MojoSourceProfileParameterContract[],
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
):
  | { readonly kind: "resolved"; readonly conversions: MojoArgumentConversionMap }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const conversions = new Map<MojoSelectedArgumentBinding, MojoValueConversion>();
  for (const [parameterIndex, contract] of contracts.entries()) {
    if (contract !== "js-data" || !sourceCall.sourceArgumentBindings.some(
      (binding) => binding.sourceParameterIndex === parameterIndex,
    )) continue;
    const sourceType = selectedSourceProfileArgumentType(
      parameterIndex, sourceCall, resolve, context.expressionTypes,
    );
    if (sourceType === undefined) return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_DATA_ARGUMENT_NOT_CLOSED",
      reason: `Source-profile data parameter ${parameterIndex} has no exact selected argument carrier.`,
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
    for (const binding of sourceCall.sourceArgumentBindings) {
      if (binding.sourceParameterIndex === parameterIndex) conversions.set(binding, conversion.conversion);
    }
  }
  return Object.freeze({ kind: "resolved", conversions });
}
