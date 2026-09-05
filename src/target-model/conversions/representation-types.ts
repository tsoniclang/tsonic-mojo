import type {
  MojoTruthinessConversion,
  MojoValueConversion,
} from "./model.js";
import type { MojoTargetTypeRef } from "../types/model.js";

export function mojoValueConversionRepresentationTypes(
  conversion: MojoValueConversion,
): readonly MojoTargetTypeRef[] {
  switch (conversion.kind) {
    case "identity":
    case "js-to-native-string":
      return Object.freeze([]);
    case "project-view":
    case "native-error-result-unwrap":
      return Object.freeze([conversion.sourceType, conversion.targetType]);
    case "callable-adapt":
      return Object.freeze([
        conversion.targetType,
        ...(conversion.sourceErrorType === undefined ? [] : [conversion.sourceErrorType]),
        ...(conversion.errorConversion === undefined
          ? []
          : mojoValueConversionRepresentationTypes(conversion.errorConversion)),
      ]);
    case "js-truthiness":
      return mojoTruthinessRepresentationTypes(conversion.conversion);
    case "js-callback-truthiness":
    case "primitive-cast":
    case "reference-copy":
    case "native-to-js-string":
    case "optional-none":
      return Object.freeze([conversion.targetType]);
    case "js-box":
      return Object.freeze([
        conversion.targetType,
        ...(conversion.source === "number" ? [conversion.sourceType] : []),
      ]);
    case "js-structural-object-box":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...conversion.fields.flatMap((field) => [
          field.sourceType,
          ...mojoValueConversionRepresentationTypes(field.conversion),
        ]),
      ]);
    case "js-sequence-box":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        conversion.elementType,
        ...mojoValueConversionRepresentationTypes(conversion.elementConversion),
      ]);
    case "js-tuple-box":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...conversion.elements.flatMap((element) => [
          element.sourceType,
          ...mojoValueConversionRepresentationTypes(element.conversion),
        ]),
      ]);
    case "js-optional-box":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...mojoValueConversionRepresentationTypes(conversion.valueConversion),
      ]);
    case "js-union-box":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...conversion.members.flatMap((member) => [
          member.sourceType,
          ...mojoValueConversionRepresentationTypes(member.conversion),
        ]),
      ]);
    case "js-selected-to-json":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        conversion.resultType,
        ...mojoValueConversionRepresentationTypes(conversion.resultConversion),
      ]);
    case "collection-map":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        conversion.sourceElementType,
        conversion.targetElementType,
        Object.freeze({ kind: "list", element: conversion.targetElementType }),
        ...(conversion.elementConversion === undefined
          ? []
          : mojoValueConversionRepresentationTypes(conversion.elementConversion)),
      ]);
    case "optional-some":
      return Object.freeze([
        conversion.targetType,
        ...mojoValueConversionRepresentationTypes(conversion.valueConversion),
      ]);
    case "optional-map":
    case "optional-present":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...mojoValueConversionRepresentationTypes(conversion.valueConversion),
      ]);
    case "optional-to-union":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        conversion.absentType,
        ...mojoValueConversionRepresentationTypes(conversion.valueConversion),
      ]);
    case "union-to-optional":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...conversion.presentMembers.flatMap((member) => [
          member.sourceType,
          ...mojoValueConversionRepresentationTypes(member.conversion),
        ]),
      ]);
    case "union-inject":
      return Object.freeze([
        conversion.targetType,
        conversion.memberType,
        ...mojoValueConversionRepresentationTypes(conversion.valueConversion),
      ]);
    case "union-map":
      return Object.freeze([
        conversion.sourceType,
        conversion.targetType,
        ...conversion.members.flatMap((member) => [
          member.sourceType,
          member.targetType,
          ...mojoValueConversionRepresentationTypes(member.conversion),
        ]),
      ]);
    case "narrowed-union-map":
      return Object.freeze([
        conversion.sourceType,
        conversion.selectedType,
        conversion.targetType,
        ...conversion.members.flatMap((member) => [
          member.sourceType,
          ...mojoValueConversionRepresentationTypes(member.conversion),
        ]),
      ]);
  }
}

function mojoTruthinessRepresentationTypes(
  conversion: MojoTruthinessConversion,
): readonly MojoTargetTypeRef[] {
  if (conversion.kind === "optional") {
    return Object.freeze([
      conversion.sourceType,
      ...mojoTruthinessRepresentationTypes(conversion.value),
    ]);
  }
  if (conversion.kind === "union") {
    return Object.freeze([
      conversion.sourceType,
      ...conversion.members.flatMap((member) => [
        member.type,
        ...mojoTruthinessRepresentationTypes(member.conversion),
      ]),
    ]);
  }
  return Object.freeze([]);
}
