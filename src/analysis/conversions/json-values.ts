import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";

const jsValueType = Object.freeze({ kind: "dynamic" as const, domain: "js" as const });

export type MojoJsonValueConversionSelection =
  | { readonly kind: "resolved"; readonly conversion: MojoValueConversion }
  | { readonly kind: "unsupported"; readonly reason: string };

export function selectMojoJsonValueConversion(
  source: MojoTargetTypeRef,
  structuralObjects: MojoStructuralObjectCatalog,
): MojoJsonValueConversionSelection {
  return select(source, structuralObjects, new Set());
}

function select(
  source: MojoTargetTypeRef,
  structuralObjects: MojoStructuralObjectCatalog,
  ancestors: ReadonlySet<string>,
): MojoJsonValueConversionSelection {
  if (source.kind === "dynamic" && source.domain === "js") {
    return Object.freeze({ kind: "resolved", conversion: Object.freeze({ kind: "identity" }) });
  }
  const direct = directJsonValueConversion(source);
  if (direct !== undefined) return Object.freeze({ kind: "resolved", conversion: direct });
  const key = mojoTargetTypeKey(source);
  if (ancestors.has(key)) {
    return unsupported("A recursive source carrier cannot be projected into a finite JavaScript value graph.");
  }
  const next = new Set(ancestors);
  next.add(key);
  const structural = structuralObjects.definitionForType(source);
  if (structural !== undefined) {
    const fields: Extract<MojoValueConversion, {
      readonly kind: "js-structural-object-box";
    }>["fields"][number][] = [];
    for (const [storageIndex, field] of structural.fields.entries()) {
      const conversion = select(field.type, structuralObjects, next);
      if (conversion.kind === "unsupported") {
        return unsupported(`Structural field '${field.sourceName}' is not JSON-projectable: ${conversion.reason}`);
      }
      fields.push(Object.freeze({
        sourceName: field.sourceName,
        storageIndex,
        sourceType: field.type,
        conversion: conversion.conversion,
      }));
    }
    return Object.freeze({
      kind: "resolved",
      conversion: Object.freeze({
        kind: "js-structural-object-box",
        sourceType: source,
        targetType: jsValueType,
        fields: Object.freeze(fields),
      }),
    });
  }
  const sequence = sequenceElement(source);
  if (sequence !== undefined) {
    const conversion = select(sequence.element, structuralObjects, next);
    return conversion.kind === "unsupported"
      ? unsupported(`Sequence elements are not JSON-projectable: ${conversion.reason}`)
      : Object.freeze({
          kind: "resolved",
          conversion: Object.freeze({
            kind: "js-sequence-box",
            sourceType: source,
            targetType: jsValueType,
            source: sequence.kind,
            elementType: sequence.element,
            elementConversion: conversion.conversion,
          }),
        });
  }
  if (source.kind === "tuple" || source.kind === "fixed-array") {
    const elementTypes = source.kind === "tuple"
      ? source.elements
      : fixedArrayElements(source);
    if (elementTypes === undefined) {
      return unsupported("A JSON fixed array requires one finite non-negative compile-time length.");
    }
    const elements = elementTypes.map((elementType, index) => {
      const conversion = select(elementType, structuralObjects, next);
      return conversion.kind === "unsupported"
        ? undefined
        : Object.freeze({ index, sourceType: elementType, conversion: conversion.conversion });
    });
    const missing = elements.findIndex((element) => element === undefined);
    return missing !== -1
      ? unsupported(`Tuple element ${missing} is not JSON-projectable.`)
      : Object.freeze({
          kind: "resolved",
          conversion: Object.freeze({
            kind: "js-tuple-box",
            sourceType: source,
            targetType: jsValueType,
            elements: Object.freeze(elements as readonly NonNullable<typeof elements[number]>[]),
          }),
        });
  }
  if (source.kind === "optional") {
    const conversion = select(source.value, structuralObjects, next);
    return conversion.kind === "unsupported"
      ? conversion
      : Object.freeze({
          kind: "resolved",
          conversion: Object.freeze({
            kind: "js-optional-box",
            sourceType: source,
            targetType: jsValueType,
            valueConversion: conversion.conversion,
          }),
        });
  }
  if (source.kind === "union") {
    const members = source.members.map((member) => {
      const conversion = select(member, structuralObjects, next);
      return conversion.kind === "unsupported"
        ? undefined
        : Object.freeze({ sourceType: member, conversion: conversion.conversion });
    });
    return members.some((member) => member === undefined)
      ? unsupported("Every selected source-union member must have one exact JSON projection.")
      : Object.freeze({
          kind: "resolved",
          conversion: Object.freeze({
            kind: "js-union-box",
            sourceType: source,
            targetType: jsValueType,
            members: Object.freeze(members as readonly NonNullable<typeof members[number]>[]),
          }),
        });
  }
  return unsupported(`Carrier '${key}' has no exact JavaScript value projection.`);
}

function directJsonValueConversion(source: MojoTargetTypeRef): MojoValueConversion | undefined {
  if (source.kind === "source-primitive") {
    if (source.name === "bool") {
      return Object.freeze({ kind: "js-box", targetType: jsValueType, source: "bool" });
    }
    return source.name === "char" || source.name === "decimal"
      ? undefined
      : Object.freeze({ kind: "js-box", targetType: jsValueType, source: "number", sourceType: source });
  }
  const sourceKind = source.kind === "native-string"
    ? "native-string" as const
    : source.kind === "target-named" && source.id === "tsonic.mojo.js.JsString"
      ? "string" as const
      : source.kind === "symbol"
        ? "symbol" as const
        : source.kind === "null"
          ? "null" as const
          : source.kind === "undefined"
            ? "undefined" as const
            : undefined;
  return sourceKind === undefined
    ? undefined
    : Object.freeze({ kind: "js-box", targetType: jsValueType, source: sourceKind });
}

function sequenceElement(type: MojoTargetTypeRef): {
  readonly kind: "js-array";
  readonly element: MojoTargetTypeRef;
} | undefined {
  if (type.kind !== "target-named" || type.id !== "tsonic.mojo.js.JsArray") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type"
    ? Object.freeze({ kind: "js-array", element: argument.type })
    : undefined;
}

function fixedArrayElements(
  type: Extract<MojoTargetTypeRef, { readonly kind: "fixed-array" }>,
): readonly MojoTargetTypeRef[] | undefined {
  if (type.length.kind !== "integer") return undefined;
  const length = Number(type.length.value);
  return Number.isSafeInteger(length) && length >= 0
    ? Object.freeze(Array.from({ length }, () => type.element))
    : undefined;
}

function unsupported(reason: string): MojoJsonValueConversionSelection {
  return Object.freeze({ kind: "unsupported", reason });
}
