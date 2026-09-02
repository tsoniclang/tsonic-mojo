import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTruthinessConversion } from "../../target-model/conversions/model.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";

export type MojoConversionClassification =
  | { readonly kind: "resolved"; readonly conversion: MojoValueConversion }
  | { readonly kind: "unsupported"; readonly reason: string };

export interface MojoConversionIndex {
  record(
    expression: Node,
    actual: MojoTargetTypeRef,
    expected: MojoTargetTypeRef,
  ): MojoConversionClassification;
  get(
    expression: Node,
    expected: MojoTargetTypeRef,
  ): MojoValueConversion | undefined;
}

export function createMojoConversionIndex(): MojoConversionIndex {
  const byExpression = new WeakMap<Node, Map<string, MojoValueConversion>>();
  let sealed = false;
  const index: MojoConversionIndex = {
    record(
      expression: Node,
      actual: MojoTargetTypeRef,
      expected: MojoTargetTypeRef,
    ): MojoConversionClassification {
      if (sealed) throw new Error("Mojo conversions cannot be recorded after analysis is sealed.");
      const classified = classifyMojoValueConversion(actual, expected);
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
    get(
      expression: Node,
      expected: MojoTargetTypeRef,
    ): MojoValueConversion | undefined {
      sealed = true;
      return byExpression.get(expression)?.get(mojoTargetTypeKey(expected));
    },
  };
  return Object.freeze(index);
}

export function classifyMojoValueConversion(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
): MojoConversionClassification {
  if (mojoTargetTypeEquals(actual, expected)) {
    return { kind: "resolved", conversion: Object.freeze({ kind: "identity" }) };
  }
  if (isNonRaisingFunctionWidening(actual, expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "callable-raise-widen", targetType: expected }),
    };
  }
  if (isCallableErrorErasure(actual, expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "callable-error-erase", targetType: expected }),
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
      : classifyMojoValueConversion(sourceCollection.element, targetCollection.element);
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
    const source = jsValueSourceKind(actual);
    if (source !== undefined) {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "js-box", targetType: expected, source }),
      };
    }
  }
  if (actual.kind === "source-primitive" && expected.kind === "source-primitive") {
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
      const value = classifyMojoValueConversion(actual.value, expected.value);
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
    if (actual.kind === "undefined") {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "optional-none", targetType: expected }),
      };
    }
    const value = classifyMojoValueConversion(actual, expected.value);
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
      const value = selectUnionMemberConversion(actual.value, expected.members);
      if (absent.length === 1 && value.kind === "resolved") {
        return {
          kind: "resolved",
          conversion: Object.freeze({
            kind: "optional-to-union",
            sourceType: actual,
            targetType: expected,
            absentType: absent[0]!,
            valueConversion: Object.freeze({
              kind: "union-inject",
              targetType: expected,
              memberType: value.targetType,
              valueConversion: value.conversion,
            }),
          }),
        };
      }
    }
    if (actual.kind === "union") {
      const members = actual.members.map((sourceType) => {
        const selected = selectUnionMemberConversion(sourceType, expected.members);
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
      const selected = selectUnionMemberConversion(actual, expected.members);
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
    const value = classifyMojoValueConversion(actual.value, expected);
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
    const conversion = classifyMojoValueConversion(actual, member);
    return conversion.kind === "resolved"
      ? [Object.freeze({ targetType: member, conversion: conversion.conversion })]
      : [];
  });
  return converted.length === 1
    ? Object.freeze({ kind: "resolved", ...converted[0]! })
    : Object.freeze({ kind: "unsupported" });
}

function classifyTruthiness(type: MojoTargetTypeRef): MojoTruthinessConversion | undefined {
  if (type.kind === "null" || type.kind === "undefined" || type.kind === "unit") {
    return Object.freeze({ kind: "always-false" });
  }
  if (type.kind === "native-string" || isJsString(type)) {
    return Object.freeze({ kind: "string" });
  }
  if (type.kind === "dynamic" && type.domain === "js") {
    return Object.freeze({ kind: "dynamic" });
  }
  if (type.kind === "source-primitive") {
    if (type.name === "bool") return undefined;
    if (type.name === "float32" || type.name === "float64") {
      return Object.freeze({ kind: "float" });
    }
    if (type.name === "char") return Object.freeze({ kind: "always-true" });
    return Object.freeze({ kind: "integer" });
  }
  if (type.kind === "bigint") return Object.freeze({ kind: "integer" });
  if (type.kind === "optional") {
    const value = classifyTruthiness(type.value);
    return value === undefined
      ? undefined
      : Object.freeze({ kind: "optional", sourceType: type, value });
  }
  if (type.kind === "union") {
    const members = type.members.map((member) => {
      const conversion = classifyTruthiness(member);
      return conversion === undefined ? undefined : Object.freeze({ type: member, conversion });
    });
    return members.some((member) => member === undefined)
      ? undefined
      : Object.freeze({
          kind: "union",
          sourceType: type,
          members: Object.freeze(members as readonly {
            readonly type: MojoTargetTypeRef;
            readonly conversion: MojoTruthinessConversion;
          }[]),
        });
  }
  if (type.kind === "never") return Object.freeze({ kind: "always-false" });
  if (type.kind === "type-parameter" || type.kind === "associated" ||
    type.kind === "compiler-expression" || type.kind === "symbol") return undefined;
  return Object.freeze({ kind: "always-true" });
}

function isNonRaisingFunctionWidening(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
): boolean {
  if (actual.kind !== "callable" || expected.kind !== "callable" ||
    actual.raises || !expected.raises) {
    return false;
  }
  return mojoTargetTypeEquals(
    Object.freeze({
      ...actual,
      raises: true,
      ...(expected.errorType === undefined ? {} : { errorType: expected.errorType }),
    }),
    expected,
  );
}

function isCallableErrorErasure(
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
): boolean {
  if (actual.kind !== "callable" || expected.kind !== "callable" ||
    !actual.raises || !expected.raises || !isNativeErrorType(expected.errorType)) {
    return false;
  }
  const actualError = actual.errorType;
  if (actualError === undefined || isNativeErrorType(actualError)) return false;
  return mojoTargetTypeEquals(
    Object.freeze({ ...actual, errorType: expected.errorType }),
    expected,
  );
}

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

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

function isJsValue(type: MojoTargetTypeRef): boolean {
  return type.kind === "dynamic" && type.domain === "js";
}

function isJsArray(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray";
}

function collectionShape(type: MojoTargetTypeRef): {
  readonly kind: "list" | "js-array";
  readonly element: MojoTargetTypeRef;
} | undefined {
  if (type.kind === "list") return Object.freeze({ kind: "list", element: type.element });
  const element = jsArrayElement(type);
  return element === undefined
    ? undefined
    : Object.freeze({ kind: "js-array", element });
}

function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isJsArray(type) || type.kind !== "target-named") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

function jsValueSourceKind(
  type: MojoTargetTypeRef,
): Extract<MojoValueConversion, { kind: "js-box" }>["source"] | undefined {
  if (type.kind === "source-primitive") {
    if (type.name === "bool") return "bool";
    if (type.name === "float64") return "number";
  }
  if (isJsString(type)) return "string";
  if (type.kind === "null") return "null";
  if (type.kind === "undefined") return "undefined";
  return undefined;
}

function sameConversion(left: MojoValueConversion, right: MojoValueConversion): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
