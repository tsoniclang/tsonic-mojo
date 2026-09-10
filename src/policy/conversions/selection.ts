import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoValueConversionNarrowing } from "../../target-model/conversions/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import { collectionShape, isJsString, isJsValue, jsValueBoxConversion, sameConversion } from "./javascript-conversions.js";
import { mojoValueConversionRepresentationTypes } from "../../target-model/conversions/representation-types.js";
import type { MojoJsValueGraph, MojoSourceValueProtocol } from "../../target-model/conversions/js-value-graph.js";
import { mojoJsValueGraphEquals } from "../../target-model/conversions/equality.js";
import type { MojoSourceValueFunction } from "../../target-model/conversions/source-value-function.js";
import { classifyTruthiness } from "./truthiness.js";
import type { MojoCopyCapability } from "../../target-model/lifecycle/model.js";

export type MojoConversionClassification =
  | { readonly kind: "resolved"; readonly conversion: MojoValueConversion }
  | { readonly kind: "unsupported"; readonly reason: string };

export type MojoSourceValueProjectionSelector = (type: MojoTargetTypeRef, protocol?: MojoSourceValueProtocol) => MojoConversionClassification;
export type MojoSourceValueExtractionSelector = (type: MojoTargetTypeRef) => MojoSourceValueFunction | undefined;
export type MojoParameterCopySelector = (type: MojoTargetTypeRef) => MojoCopyCapability;

export interface MojoConversionIndex {
  projectData(actual: MojoTargetTypeRef): MojoConversionClassification;
  classify(actual: MojoTargetTypeRef, expected: MojoTargetTypeRef, narrowing?: MojoValueConversionNarrowing): MojoConversionClassification;
  record(
    expression: Node,
    actual: MojoTargetTypeRef,
    expected: MojoTargetTypeRef,
  ): MojoConversionClassification;
  finalizeCallable(
    expression: Node,
    actual: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
    expected: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  ): MojoConversionClassification;
  get(
    expression: Node,
    expected: MojoTargetTypeRef,
  ): MojoValueConversion | undefined;
  recordedFor(expression: Node): readonly MojoValueConversion[];
  representationTypes(): readonly MojoTargetTypeRef[];
  sourceValueGraphs(): readonly MojoJsValueGraph[];
}

export function createMojoConversionIndex(
  input: {
    readonly narrowingForExpression: (expression: Node) => MojoValueConversionNarrowing | undefined;
    readonly projectRelationships: MojoProjectTypeRelationships;
    readonly sourceValueProjection: MojoSourceValueProjectionSelector;
    readonly sourceValueExtraction?: MojoSourceValueExtractionSelector;
    readonly parameterCopy?: MojoParameterCopySelector;
  },
): MojoConversionIndex {
  const { narrowingForExpression, projectRelationships } = input;
  const sourceGraphs = new Map<string, MojoJsValueGraph>();
  const sourceValueProjection: MojoSourceValueProjectionSelector = (type, protocol = "value") => {
    const result = input.sourceValueProjection(type, protocol);
    if (result.kind === "resolved" && result.conversion.kind === "js-value-graph") {
      const previous = sourceGraphs.get(result.conversion.graph.root);
      if (previous !== undefined && !mojoJsValueGraphEquals(previous, result.conversion.graph)) {
        return { kind: "unsupported", reason: "An exact source-value projection acquired conflicting semantic definitions." };
      }
      sourceGraphs.set(result.conversion.graph.root, result.conversion.graph);
    }
    return result;
  };
  const byExpression = new WeakMap<Node, Map<string, MojoValueConversion>>();
  const finalizedCallableKeys = new WeakMap<Node, Set<string>>();
  const representationTypesByKey = new Map<string, MojoTargetTypeRef>();
  let sealed = false;
  const retainRepresentationType = (type: MojoTargetTypeRef): void => {
    representationTypesByKey.set(mojoTargetTypeKey(type), type);
  };
  const retainConversion = (
    actual: MojoTargetTypeRef,
    expected: MojoTargetTypeRef,
    conversion: MojoValueConversion,
  ): void => {
    retainRepresentationType(actual);
    retainRepresentationType(expected);
    for (const type of mojoValueConversionRepresentationTypes(conversion)) {
      retainRepresentationType(type);
    }
  };
  const index: MojoConversionIndex = {
    sourceValueGraphs: () => Object.freeze([...sourceGraphs.values()]),
    projectData(actual) {
      if (sealed) throw new Error("Mojo data projections cannot be classified after analysis is sealed.");
      const result = sourceValueProjection(actual, "data");
      if (result.kind === "resolved") retainConversion(actual, Object.freeze({ kind: "dynamic", domain: "js" }), result.conversion);
      return result;
    },
    classify(actual, expected, narrowing) {
      if (sealed) throw new Error("Mojo conversions cannot be classified after analysis is sealed.");
      const result = classifyMojoValueConversion(actual, expected, narrowing, projectRelationships, sourceValueProjection, input.sourceValueExtraction, input.parameterCopy);
      if (result.kind === "resolved") retainConversion(actual, expected, result.conversion);
      return result;
    },
    record(
      expression: Node,
      actual: MojoTargetTypeRef,
      expected: MojoTargetTypeRef,
    ): MojoConversionClassification {
      if (sealed) throw new Error("Mojo conversions cannot be recorded after analysis is sealed.");
      const classified = index.classify(
        actual,
        expected,
        narrowingForExpression(expression),
      );
      if (classified.kind === "unsupported") return classified;
      const key = mojoTargetTypeKey(expected);
      const entries = byExpression.get(expression) ?? new Map<string, MojoValueConversion>();
      const existing = entries.get(key);
      if (existing !== undefined && !sameConversion(existing, classified.conversion)) {
        return {
          kind: "unsupported",
          reason: "the same source occurrence acquired contradictory Mojo conversions",
        };
      }
      entries.set(key, classified.conversion);
      byExpression.set(expression, entries);
      return classified;
    },
    finalizeCallable(
      expression: Node,
      actual: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
      expected: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
    ): MojoConversionClassification {
      if (sealed) throw new Error("Mojo conversions cannot be finalized after analysis is sealed.");
      const classified = index.classify(actual, expected);
      if (classified.kind === "unsupported") return classified;
      const key = mojoTargetTypeKey(expected);
      const finalized = finalizedCallableKeys.get(expression) ?? new Set<string>();
      const entries = byExpression.get(expression) ?? new Map<string, MojoValueConversion>();
      const existing = entries.get(key);
      if (finalized.has(key) && existing !== undefined &&
        !sameConversion(existing, classified.conversion)) {
        return {
          kind: "unsupported",
          reason: "the same source callable acquired contradictory finalized Mojo conversions",
        };
      }
      entries.set(key, classified.conversion);
      finalized.add(key);
      byExpression.set(expression, entries);
      finalizedCallableKeys.set(expression, finalized);
      return classified;
    },
    get(
      expression: Node,
      expected: MojoTargetTypeRef,
    ): MojoValueConversion | undefined {
      sealed = true;
      return byExpression.get(expression)?.get(mojoTargetTypeKey(expected));
    },
    recordedFor(expression: Node): readonly MojoValueConversion[] {
      return Object.freeze([...(byExpression.get(expression)?.values() ?? [])]);
    },
    representationTypes(): readonly MojoTargetTypeRef[] {
      return Object.freeze([...representationTypesByKey.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([, type]) => type));
    },
  };
  return Object.freeze(index);
}

export function classifyMojoValueConversion(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
  narrowing?: MojoValueConversionNarrowing,
  projectRelationships?: MojoProjectTypeRelationships,
  sourceValueProjection?: MojoSourceValueProjectionSelector,
  sourceValueExtraction?: MojoSourceValueExtractionSelector,
  parameterCopy?: MojoParameterCopySelector,
): MojoConversionClassification {
  const classify = (
    source: MojoTargetTypeRef,
    target: MojoTargetTypeRef,
    selectedNarrowing?: MojoValueConversionNarrowing,
  ): MojoConversionClassification => classifyMojoValueConversion(
    source,
    target,
    selectedNarrowing,
    projectRelationships,
    sourceValueProjection,
    sourceValueExtraction,
    parameterCopy,
  );
  if (narrowing !== undefined && mojoTargetTypeEquals(actual, narrowing.selectedType)) {
    const members = narrowing.selectedType.members.map((sourceType) => {
      const conversion = classify(sourceType, expected);
      return conversion.kind === "resolved"
        ? Object.freeze({ sourceType, conversion: conversion.conversion })
        : undefined;
    });
    if (members.length > 0 && members.every((member) => member !== undefined)) {
      return {
        kind: "resolved",
        conversion: Object.freeze({
          kind: "narrowed-union-map",
          sourceType: narrowing.sourceType,
          selectedType: narrowing.selectedType,
          targetType: expected,
          members: Object.freeze(members as readonly {
            readonly sourceType: MojoTargetTypeRef;
            readonly conversion: MojoValueConversion;
          }[]),
        }),
      };
    }
  }
  if (mojoTargetTypeEquals(actual, expected)) {
    return { kind: "resolved", conversion: Object.freeze({ kind: "identity" }) };
  }
  const expectedProject = projectRelationships?.definitionForType(expected);
  const projectRelationship = expectedProject === undefined
    ? undefined
    : projectRelationships!.relationship(actual, expectedProject);
  if (projectRelationship?.kind === "related" &&
    mojoTargetTypeEquals(projectRelationship.targetType, expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "project-view", sourceType: actual, targetType: expected }),
    };
  }
  const callable = classifyCallableAdaptation(actual, expected, projectRelationships, parameterCopy);
  if (callable !== undefined) {
    return {
      kind: "resolved",
      conversion: callable,
    };
  }
  if (expected.kind === "source-primitive" && expected.name === "bool") {
    const conversion = classifyTruthiness(actual);
    if (conversion !== undefined) {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "js-truthiness", conversion }),
      };
    }
  }
  if (isJsString(actual) && expected.kind === "native-string") {
    return { kind: "resolved", conversion: Object.freeze({ kind: "js-to-native-string" }) };
  }
  if (actual.kind === "native-string" && isJsString(expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "native-to-js-string", targetType: expected }),
    };
  }
  const sourceCollection = collectionShape(actual);
  const targetCollection = collectionShape(expected);
  if (sourceCollection !== undefined && targetCollection !== undefined) {
    const element = sourceCollection.element.kind === "never"
      ? undefined
      : classify(sourceCollection.element, targetCollection.element);
    if (sourceCollection.element.kind === "never" || element?.kind === "resolved") {
      return {
        kind: "resolved",
        conversion: Object.freeze({
          kind: "collection-map",
          sourceType: actual,
          targetType: expected,
          source: sourceCollection.kind,
          target: targetCollection.kind,
          sourceElementType: sourceCollection.element,
          targetElementType: targetCollection.element,
          ...(element?.kind === "resolved" ? { elementConversion: element.conversion } : {}),
        }),
      };
    }
  }
  if (isJsValue(expected)) {
    if (sourceValueProjection !== undefined) return sourceValueProjection(actual);
    const conversion = jsValueBoxConversion(actual, expected);
    if (conversion !== undefined) {
      return {
        kind: "resolved",
        conversion,
      };
    }
  }
  if (isJsValue(actual)) {
    const extraction = sourceValueExtraction?.(expected);
    if (extraction !== undefined) {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "js-value-extract", sourceType: actual, targetType: expected, extraction }),
      };
    }
    if (expected.kind === "union" || expected.kind === "optional") {
      return { kind: "unsupported", reason: "An erased source value requires a complete discriminant before recovery into a union or optional carrier." };
    }
  }
  if (actual.kind === "source-primitive" && expected.kind === "source-primitive") {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "primitive-cast", targetType: expected }),
    };
  }
  if (actual.kind === "bigint" && isIntegralPrimitive(expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "primitive-cast", targetType: expected }),
    };
  }
  if (actual.kind === "reference" && mojoTargetTypeEquals(actual.value, expected) &&
    isTriviallyCopyableMojoType(expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "reference-copy", targetType: expected }),
    };
  }
  if (expected.kind === "optional") {
    if (actual.kind === "optional") {
      const value = classify(actual.value, expected.value);
      if (value.kind === "resolved") {
        return {
          kind: "resolved",
          conversion: Object.freeze({
            kind: "optional-map",
            sourceType: actual,
            targetType: expected,
            valueConversion: value.conversion,
          }),
        };
      }
      return value;
    }
    if (actual.kind === "union") {
      const absentMembers = actual.members.filter((member) =>
        member.kind === "null" || member.kind === "undefined");
      const presentMembers = actual.members.filter((member) =>
        member.kind !== "null" && member.kind !== "undefined").map((sourceType) => {
        const conversion = classify(sourceType, expected.value);
        return conversion.kind === "resolved"
          ? Object.freeze({ sourceType, conversion: conversion.conversion })
          : undefined;
      });
      if (absentMembers.length !== 0 && presentMembers.every((member) => member !== undefined)) {
        return {
          kind: "resolved",
          conversion: Object.freeze({
            kind: "union-to-optional",
            sourceType: actual,
            targetType: expected,
            presentMembers: Object.freeze(presentMembers as readonly {
              readonly sourceType: MojoTargetTypeRef;
              readonly conversion: MojoValueConversion;
            }[]),
          }),
        };
      }
    }
    if (actual.kind === "undefined" || actual.kind === "null") {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "optional-none", targetType: expected }),
      };
    }
    const value = classify(actual, expected.value);
    if (value.kind === "resolved") {
      return {
        kind: "resolved",
        conversion: Object.freeze({
          kind: "optional-some",
          targetType: expected,
          valueConversion: value.conversion,
        }),
      };
    }
  }
  if (expected.kind === "union") {
    if (actual.kind === "optional") {
      const absent = expected.members.filter((member): member is Extract<MojoTargetTypeRef, {
        readonly kind: "null" | "undefined";
      }> => member.kind === "null" || member.kind === "undefined");
      const value = classify(actual.value, expected);
      if (absent.length === 1 && value.kind === "resolved") {
        return {
          kind: "resolved",
          conversion: Object.freeze({
            kind: "optional-to-union",
            sourceType: actual,
            targetType: expected,
            absentType: absent[0]!,
            valueConversion: value.conversion,
          }),
        };
      }
    }
    if (actual.kind === "union") {
      const members = actual.members.map((sourceType) => {
        const selected = selectUnionMemberConversion(sourceType, expected.members, projectRelationships, sourceValueProjection, sourceValueExtraction, parameterCopy);
        return selected.kind === "resolved"
          ? Object.freeze({
              sourceType,
              targetType: selected.targetType,
              conversion: selected.conversion,
            })
          : undefined;
      });
      if (members.every((member) => member !== undefined)) {
        return {
          kind: "resolved",
          conversion: Object.freeze({
            kind: "union-map",
            sourceType: actual,
            targetType: expected,
            members: Object.freeze(members as readonly {
              readonly sourceType: MojoTargetTypeRef;
              readonly targetType: MojoTargetTypeRef;
              readonly conversion: MojoValueConversion;
            }[]),
          }),
        };
      }
    } else {
      const selected = selectUnionMemberConversion(actual, expected.members, projectRelationships, sourceValueProjection, sourceValueExtraction, parameterCopy);
      if (selected.kind === "resolved") {
        return {
          kind: "resolved",
          conversion: Object.freeze({
            kind: "union-inject",
            targetType: expected,
            memberType: selected.targetType,
            valueConversion: selected.conversion,
          }),
        };
      }
    }
  }
  if (actual.kind === "optional") {
    const value = classify(actual.value, expected);
    if (value.kind === "resolved") {
      return {
        kind: "resolved",
        conversion: Object.freeze({
          kind: "optional-present",
          sourceType: actual,
          targetType: expected,
          valueConversion: value.conversion,
        }),
      };
    }
  }
  return {
    kind: "unsupported",
    reason: `no exact Mojo conversion exists from '${mojoTargetTypeKey(actual)}' to '${mojoTargetTypeKey(expected)}'`,
  };
}

type UnionMemberConversion =
  | {
      readonly kind: "resolved";
      readonly targetType: MojoTargetTypeRef;
      readonly conversion: MojoValueConversion;
    }
  | { readonly kind: "unsupported" };

function selectUnionMemberConversion(
  actual: MojoTargetTypeRef,
  members: readonly MojoTargetTypeRef[],
  projectRelationships?: MojoProjectTypeRelationships,
  sourceValueProjection?: MojoSourceValueProjectionSelector,
  sourceValueExtraction?: MojoSourceValueExtractionSelector,
  parameterCopy?: MojoParameterCopySelector,
): UnionMemberConversion {
  const exact = members.filter((member) => mojoTargetTypeEquals(actual, member));
  if (exact.length === 1) {
    return Object.freeze({
      kind: "resolved",
      targetType: exact[0]!,
      conversion: Object.freeze({ kind: "identity" }),
    });
  }
  if (exact.length > 1) return Object.freeze({ kind: "unsupported" });
  const converted = members.flatMap((member) => {
    const conversion = classifyMojoValueConversion(actual, member, undefined, projectRelationships, sourceValueProjection, sourceValueExtraction, parameterCopy);
    return conversion.kind === "resolved"
      ? [Object.freeze({ targetType: member, conversion: conversion.conversion })]
      : [];
  });
  return converted.length === 1
    ? Object.freeze({ kind: "resolved", ...converted[0]! })
    : Object.freeze({ kind: "unsupported" });
}

function isIntegralPrimitive(
  type: MojoTargetTypeRef,
): type is Extract<MojoTargetTypeRef, { readonly kind: "source-primitive" }> {
  return type.kind === "source-primitive" && type.name !== "bool" &&
    type.name !== "char" && type.name !== "float16" &&
    type.name !== "float32" && type.name !== "float64";
}

function classifyCallableAdaptation(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
  projectRelationships?: MojoProjectTypeRelationships,
  parameterCopy?: MojoParameterCopySelector,
): Extract<MojoValueConversion, { readonly kind: "callable-adapt" }> | undefined {
  if (actual.kind !== "callable" || expected.kind !== "callable") return undefined;
  if (actual.parameters.length > expected.parameters.length) return undefined;
  const prefix = actual.parameters.length < expected.parameters.length;
  const argumentCopies: ("implicit" | "explicit")[] = [];
  if (prefix) {
    if ([...actual.parameters, ...expected.parameters].some((parameter) =>
      parameter.convention !== "imm" || parameter.passing !== "plain" ||
      parameter.omissionKind === "rest")) return undefined;
    for (const parameter of actual.parameters) {
      const copy = parameterCopy?.(parameter.type);
      if (copy !== "implicit" && copy !== "explicit") return undefined;
      argumentCopies.push(copy);
    }
  }
  const result = mojoTargetTypeEquals(actual.result, expected.result)
    ? "preserve" as const
    : actual.result.kind === "never"
      ? "never" as const
      : undefined;
  if (result === undefined) return undefined;
  let error: "preserve" | "widen" | "erase";
  let errorConversion: MojoValueConversion | undefined;
  const actualErrorType = actual.raises
    ? actual.errorType ?? mojoNativeErrorType
    : undefined;
  const expectedErrorType = expected.raises
    ? expected.errorType ?? mojoNativeErrorType
    : undefined;
  if (actual.raises === expected.raises && (!actual.raises || mojoTargetTypeEquals(
    actualErrorType!,
    expectedErrorType!,
  ))) {
    error = "preserve";
  } else if (!actual.raises && expected.raises) {
    error = "widen";
  } else if (actual.raises && expected.raises &&
    !isNativeErrorType(actual.errorType) && isNativeErrorType(expected.errorType)) {
    error = "erase";
  } else if (actualErrorType !== undefined && expectedErrorType !== undefined) {
    const classifiedError = classifyMojoValueConversion(
      actualErrorType,
      expectedErrorType,
      undefined,
      projectRelationships,
      undefined,
      undefined,
      parameterCopy,
    );
    if (classifiedError.kind === "unsupported") return undefined;
    error = "widen";
    errorConversion = classifiedError.conversion;
  } else {
    return undefined;
  }
  const { errorType: _actualErrorType, ...actualBase } = actual;
  const normalized = Object.freeze({
    ...actualBase,
    result: expected.result,
    raises: expected.raises,
    ...(expected.errorType === undefined ? {} : { errorType: expected.errorType }),
  });
  if (!mojoTargetTypeEquals(
    Object.freeze({ ...normalized, parameters: actual.parameters }),
    Object.freeze({ ...expected, parameters: expected.parameters.slice(0, actual.parameters.length) }),
  )) return undefined;
  return Object.freeze({
    kind: "callable-adapt",
    sourceType: actual,
    targetType: expected,
    parameters: prefix ? Object.freeze({ kind: "prefix", copies: Object.freeze(argumentCopies) }) : Object.freeze({ kind: "identity" }),
    result,
    error,
    ...(actualErrorType === undefined ? {} : { sourceErrorType: actualErrorType }),
    ...(errorConversion === undefined
      ? {}
      : { errorConversion }),
  });
}

const mojoNativeErrorType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "mojo.builtin.Error",
  modulePath: Object.freeze([]),
  name: "Error",
});

function isNativeErrorType(type: MojoTargetTypeRef | undefined): boolean {
  return type === undefined || (type.kind === "target-named" &&
    type.id === "mojo.builtin.Error");
}

function isTriviallyCopyableMojoType(type: MojoTargetTypeRef): boolean {
  if (type.kind === "source-primitive") return true;
  if (type.kind === "unit" || type.kind === "never" || type.kind === "null" ||
    type.kind === "undefined") return true;
  return type.kind === "tuple" && type.elements.every(isTriviallyCopyableMojoType);
}
