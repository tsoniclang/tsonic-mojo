import type { ResolvedSourcePropertyAccessInfo } from "@tsonic/tsts";
import type { MojoPropertyAnalysis, MojoProviderPropertyAnalysisContext } from "./properties.js";
import { mojoIteratorResultProperty } from "../../policy/types/js-iterator.js";
import { canonicalMojoIteratorResult } from "../../policy/types/js-iterator.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";

export function analyzeMojoIteratorResultProperty(
  source: ResolvedSourcePropertyAccessInfo,
  context: MojoProviderPropertyAnalysisContext,
): MojoPropertyAnalysis | undefined {
  const semantics = context.source.semantics.forNode(source.expression);
  const declarations = [
    source.selectedDeclaration, source.selectedReadDeclaration, source.selectedWriteDeclaration,
    ...(source.selectedSymbol === undefined ? []
      : semantics.declarations.symbolDeclarations(source.selectedSymbol)),
  ];
  const identities = declarations.flatMap((declaration) => {
    const identity = context.sourceProfiles.declarationIdentity(declaration);
    return identity === undefined ? [] : [identity];
  });
  const first = identities[0];
  if (!identities.some((identity) => identity.profile === "js" &&
    (identity.declaringName === "IteratorYieldResult" ||
      identity.declaringName === "IteratorReturnResult"))) return undefined;
  const receiverType = context.resolveType(source.receiver.type);
  if (receiverType?.kind !== "union" ||
    canonicalMojoIteratorResult(receiverType.members) === undefined) return undefined;
  if (first === undefined || first.kind !== "member" || first.profile !== "js" ||
    (first.name !== "done" && first.name !== "value") ||
    identities.some((identity) => identity.kind !== "member" || identity.profile !== "js" ||
      identity.name !== first.name ||
      (identity.declaringName !== "IteratorYieldResult" &&
        identity.declaringName !== "IteratorReturnResult"))) {
    return {
      kind: "unsupported", code: "MOJO_ITERATOR_RESULT_PROPERTY_IDENTITY_UNPROVEN",
      reason: "An iterator-result projection requires exact source-profile member declarations.",
    };
  }
  if (source.accessMode !== "read" || source.optionalChain || source.sourceReadType === undefined) {
    return {
      kind: "unsupported", code: "MOJO_ITERATOR_RESULT_UNION_LOCATION_UNSUPPORTED",
      reason: "An iterator-result union must be narrowed before mutation or optional member access.",
    };
  }
  const resultType = context.resolveType(source.sourceReadType);
  if (resultType === undefined) return {
    kind: "unsupported", code: "MOJO_ITERATOR_RESULT_PROPERTY_TYPE_UNPROVEN",
    reason: "The selected iterator-result property has no closed result carrier.",
  };
  const variants = [];
  for (const member of receiverType.members) {
    const propertyType = mojoIteratorResultProperty(member, first.name);
    const conversion = propertyType === undefined ? undefined
      : classifyMojoValueConversion(propertyType, resultType);
    if (conversion === undefined || conversion.kind === "unsupported") return {
      kind: "unsupported", code: "MOJO_ITERATOR_RESULT_PROPERTY_CONVERSION_UNPROVEN",
      reason: "Every iterator-result alternative requires an exact property conversion.",
    };
    variants.push(Object.freeze({
      receiverType: member,
      readName: first.name === "done" ? "get_done" : "get_value",
      readConversion: conversion.conversion,
    }));
  }
  return {
    kind: "resolved", expressionType: resultType,
    selection: Object.freeze({
      kind: "provider-union-property", receiver: source.receiver.expression,
      receiverType, variants: Object.freeze(variants), resultType, accessMode: "read",
    }),
  };
}
