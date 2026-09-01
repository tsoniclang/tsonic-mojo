import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";

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
  if (isJsString(actual) && expected.kind === "native-string") {
    return { kind: "resolved", conversion: Object.freeze({ kind: "js-to-native-string" }) };
  }
  if (actual.kind === "native-string" && isJsString(expected)) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "native-to-js-string", targetType: expected }),
    };
  }
  if (actual.kind === "source-primitive" && expected.kind === "source-primitive") {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "primitive-cast", targetType: expected }),
    };
  }
  if (expected.kind === "optional") {
    if (actual.kind === "undefined") {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "optional-none", targetType: expected }),
      };
    }
    if (mojoTargetTypeEquals(actual, expected.value)) {
      return {
        kind: "resolved",
        conversion: Object.freeze({ kind: "optional-some", targetType: expected }),
      };
    }
  }
  if (expected.kind === "union" && expected.members.some((member) => mojoTargetTypeEquals(member, actual))) {
    return {
      kind: "resolved",
      conversion: Object.freeze({ kind: "union-inject", targetType: expected }),
    };
  }
  return {
    kind: "unsupported",
    reason: `no exact Mojo conversion exists from '${mojoTargetTypeKey(actual)}' to '${mojoTargetTypeKey(expected)}'`,
  };
}

export function mojoTargetTypeKey(type: MojoTargetTypeRef): string {
  return JSON.stringify(type);
}

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

function sameConversion(left: MojoValueConversion, right: MojoValueConversion): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
