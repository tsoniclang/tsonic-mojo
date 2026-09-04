import type {
  MojoAnalyzedParameter,
  MojoCallableParameterAdapter,
} from "../program/model.js";
import { mojoParameterConvention } from "../representations/index.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";

export function selectMojoCallableParameterAdapters(
  sources: readonly MojoAnalyzedParameter[],
  targets: readonly MojoAnalyzedParameter[],
  relationships: MojoProjectTypeRelationships,
): readonly MojoCallableParameterAdapter[] | undefined {
  const adapters: MojoCallableParameterAdapter[] = [];
  for (const [targetIndex, target] of targets.entries()) {
    if (target.omissionKind === "rest") {
      if (targetIndex !== targets.length - 1) return undefined;
      const remaining = sources.slice(targetIndex);
      const sourceRest = remaining.length === 1 && remaining[0]?.omissionKind === "rest"
        ? remaining[0]
        : undefined;
      if (sourceRest !== undefined) {
        if (!sameParameterConvention(sourceRest, target)) return undefined;
        const conversion = classifyMojoValueConversion(
          sourceRest.type,
          target.type,
          undefined,
          relationships,
        );
        if (conversion.kind === "unsupported") return undefined;
        adapters.push(Object.freeze({
          kind: "sequence-rest",
          sourceIndex: targetIndex,
          source: sourceRest,
          target,
          elementConversion: conversion.conversion,
        }));
        continue;
      }
      if (remaining.some((source) =>
        source.omissionKind !== "required" || !sameParameterConvention(source, target))) {
        return undefined;
      }
      const conversions: import("../../target-model/conversions/model.js").MojoValueConversion[] = [];
      for (const source of remaining) {
        const conversion = classifyMojoValueConversion(
          source.callType,
          target.type,
          undefined,
          relationships,
        );
        if (conversion.kind === "unsupported") return undefined;
        conversions.push(conversion.conversion);
      }
      adapters.push(Object.freeze({
        kind: "fixed-rest",
        sourceIndexes: Object.freeze(remaining.map((_source, index) => targetIndex + index)),
        sources: Object.freeze(remaining),
        target,
        conversions: Object.freeze(conversions),
      }));
      continue;
    }
    const source = sources[targetIndex];
    if (source === undefined) {
      if (target.omissionKind !== "undefined" && target.omissionKind !== "initializer") {
        return undefined;
      }
      adapters.push(Object.freeze({ kind: "omitted", target }));
      continue;
    }
    if (source.omissionKind === "rest" || !sameParameterConvention(source, target)) {
      return undefined;
    }
    const conversion = classifyMojoValueConversion(
      source.callType,
      target.callType,
      undefined,
      relationships,
    );
    if (conversion.kind === "unsupported") return undefined;
    adapters.push(Object.freeze({
      kind: "value",
      sourceIndex: targetIndex,
      source,
      target,
      conversion: conversion.conversion,
    }));
  }
  return Object.freeze(adapters);
}

function sameParameterConvention(
  source: MojoAnalyzedParameter,
  target: MojoAnalyzedParameter,
): boolean {
  return mojoParameterConvention(source.disposition) === mojoParameterConvention(target.disposition);
}
