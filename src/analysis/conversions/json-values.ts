import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import type { MojoAnalyzedProjectCallable } from "../program/model.js";
import type {
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";

const jsValueType = Object.freeze({ kind: "dynamic" as const, domain: "js" as const });

export type MojoJsonValueConversionSelection =
  | { readonly kind: "resolved"; readonly conversion: MojoValueConversion }
  | { readonly kind: "unsupported"; readonly reason: string };

export interface MojoJsonValueConversionContext {
  readonly source: TargetSourceProgram;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleResolver;
  readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
}

export function selectMojoJsonValueConversion(
  source: MojoTargetTypeRef,
  context: MojoJsonValueConversionContext,
): MojoJsonValueConversionSelection {
  return select(source, context, new Set(), true);
}

function select(
  source: MojoTargetTypeRef,
  context: MojoJsonValueConversionContext,
  ancestors: ReadonlySet<string>,
  applySelectedToJson: boolean,
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
  if (applySelectedToJson) {
    const projection = selectedProjectToJson(source, context, next);
    if (projection.kind !== "absent") return projection;
  }
  const structural = context.structuralObjects.definitionForType(source);
  if (structural !== undefined) {
    const fields: Extract<MojoValueConversion, {
      readonly kind: "js-structural-object-box";
    }>["fields"][number][] = [];
    for (const [storageIndex, field] of structural.fields.entries()) {
      const conversion = select(field.type, context, next, true);
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
    const conversion = select(sequence.element, context, next, true);
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
      const conversion = select(elementType, context, next, true);
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
    const conversion = select(source.value, context, next, true);
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
      const conversion = select(member, context, next, true);
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

type ProjectToJsonSelection =
  | { readonly kind: "absent" }
  | MojoJsonValueConversionSelection;

function selectedProjectToJson(
  sourceType: MojoTargetTypeRef,
  context: MojoJsonValueConversionContext,
  ancestors: ReadonlySet<string>,
): ProjectToJsonSelection {
  const definition = context.projectRelationships.definitionForType(sourceType);
  if (definition === undefined) return Object.freeze({ kind: "absent" });
  const semantics = context.source.semantics.forFile(definition.sourceFile);
  const declaredType = semantics.declarations.declaredType(definition.declaration);
  if (declaredType === undefined) {
    return unsupported("A project JSON projection has no exact declared source type.");
  }
  const properties = semantics.types.propertyInfos(declaredType).filter(
    (property) => property.name === "toJSON",
  );
  if (properties.length === 0) return Object.freeze({ kind: "absent" });
  if (properties.length !== 1 || properties[0]!.optional) {
    return unsupported("A project JSON projection requires one required checker-selected toJSON property.");
  }
  const property = properties[0]!;
  const declarations = [...new Set(
    [property.symbol, ...property.rootSymbols].flatMap((symbol) =>
      semantics.declarations.symbolDeclarations(symbol)),
  )];
  const callables = [...new Set(declarations.map((declaration) =>
    context.callableByDeclaration.get(declaration)).filter(
      (callable): callable is MojoAnalyzedProjectCallable => callable !== undefined,
    ))];
  if (callables.length !== 1) {
    return unsupported("A project toJSON property must resolve to one exact analyzed method contract.");
  }
  const callable = callables[0]!;
  const contract = callable.contract;
  if (contract.kind !== "method" || contract.static === true || contract.asynchronous ||
    contract.typeParameters.length !== 0) {
    return unsupported("A selected toJSON projection must be one synchronous, non-generic instance method.");
  }
  const owner = context.projectRelationships.definitionContainingDeclaration(contract.declaration);
  const relationship = owner === undefined
    ? undefined
    : context.projectRelationships.relationship(sourceType, owner);
  if (owner === undefined || relationship?.kind !== "related") {
    return unsupported("A selected toJSON method has no exact project receiver relationship.");
  }
  const parameters = contract.parameters.map((parameter) => {
    const type = context.projectRelationships.instantiateMemberType(
      contract.declaration,
      relationship.targetType,
      parameter.callType,
    );
    return type === undefined ? undefined : Object.freeze({ parameter, type });
  });
  const passesPropertyKey = parameters.length === 1 &&
    parameters[0]?.type.kind === "native-string";
  if ((parameters.length !== 0 && !passesPropertyKey) ||
    parameters.some((parameter) => parameter === undefined) ||
    parameters.length === 1 && parameters[0]?.parameter.disposition.kind !== "immutable") {
    return unsupported("A selected toJSON method accepts either no parameters or one immutable native string key.");
  }
  const resultType = context.projectRelationships.instantiateMemberType(
    contract.declaration,
    relationship.targetType,
    contract.resultType,
  );
  if (resultType === undefined) {
    return unsupported("A selected toJSON method has no exact instantiated result carrier.");
  }
  const result = select(resultType, context, ancestors, false);
  if (result.kind === "unsupported") {
    return unsupported(`The selected toJSON result is not JSON-projectable: ${result.reason}`);
  }
  const sourceCopy = context.lifecycle.capabilities(sourceType).copy;
  if (sourceCopy === "unavailable") {
    return unsupported("A selected toJSON receiver cannot be retained without consuming its source value.");
  }
  return Object.freeze({
    kind: "resolved",
    conversion: Object.freeze({
      kind: "js-selected-to-json",
      sourceType,
      targetType: jsValueType,
      declaration: contract.declaration,
      methodName: contract.name,
      passesPropertyKey,
      resultType,
      resultConversion: result.conversion,
      sourceCopy,
    }),
  });
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
