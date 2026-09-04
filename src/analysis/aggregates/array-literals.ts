import type { AstReader, Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import {
  classifyMojoValueConversion,
  type MojoConversionIndex,
} from "../../policy/conversions/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoLifecycleAnalysis } from "../lifecycle/model.js";
import type { MojoValueOwnership } from "../../target-model/lifecycle/model.js";
import type {
  MojoArrayLiteralContribution,
  MojoArrayLiteralFixedSpreadValue,
  MojoArrayLiteralSelection,
} from "./model.js";

export type MojoArrayLiteralAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoArrayLiteralSelection }
  | {
      readonly kind: "unsupported";
      readonly code: string;
      readonly reason: string;
      readonly node: Node;
    };

export interface MojoArrayLiteralAnalysisInput {
  readonly ast: AstReader;
  readonly expression: Node;
  readonly resultType: MojoTargetTypeRef;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly conversions: MojoConversionIndex;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleAnalysis;
  readonly valueOwnership: (expression: Node) => MojoValueOwnership;
}

export function analyzeMojoArrayLiteral(
  input: MojoArrayLiteralAnalysisInput,
): MojoArrayLiteralAnalysis {
  const target = targetShape(input.resultType);
  if (target === undefined) {
    return unsupported(
      "MOJO_ARRAY_LITERAL_TARGET_NOT_CLOSED",
      "An array literal requires one exact native List, fixed array, tuple, or JavaScript array carrier.",
      input.expression,
    );
  }
  const contributions: MojoArrayLiteralContribution[] = [];
  let targetIndex = 0;
  for (const element of input.ast.elements(input.expression)) {
    if (element === undefined || input.ast.is.IsOmittedExpression(element)) {
      return unsupported(
        "MOJO_ARRAY_LITERAL_HOLE_UNSUPPORTED",
        "A sparse array hole has no exact native Mojo aggregate representation.",
        element ?? input.expression,
      );
    }
    if (!input.ast.is.IsSpreadElement(element)) {
      const actualType = input.expressionTypes.get(element);
      const targetType = targetTypeAt(target, targetIndex);
      if (actualType === undefined || targetType === undefined) {
        return unsupported(
          "MOJO_ARRAY_LITERAL_ELEMENT_NOT_CLOSED",
          "An array literal element has no exact source and target carrier.",
          element,
        );
      }
      const conversion = input.conversions.record(element, actualType, targetType);
      if (conversion.kind === "unsupported") {
        return unsupported(
          "MOJO_ARRAY_LITERAL_ELEMENT_CONVERSION_UNPROVEN",
          conversion.reason,
          element,
        );
      }
      contributions.push(Object.freeze({
        kind: "value",
        sourceElement: element,
        expression: element,
        targetType,
      }));
      targetIndex += 1;
      continue;
    }
    const expression = Node_Expression(input.ast, element);
    const sourceType = expression === undefined ? undefined : input.expressionTypes.get(expression);
    if (expression === undefined || sourceType === undefined) {
      return unsupported(
        "MOJO_ARRAY_SPREAD_SOURCE_NOT_CLOSED",
        "An array spread requires one exact source expression and aggregate carrier.",
        element,
      );
    }
    const fixed = fixedElementTypes(sourceType);
    if (fixed !== undefined) {
      const sourceOwnership = input.valueOwnership(expression);
      const values: MojoArrayLiteralFixedSpreadValue[] = [];
      for (const [index, sourceElementType] of fixed.entries()) {
        const targetType = targetTypeAt(target, targetIndex);
        if (targetType === undefined) {
          return unsupported(
            "MOJO_ARRAY_SPREAD_TARGET_ARITY_CONFLICT",
            "A fixed array spread supplies more values than the selected target aggregate accepts.",
            element,
          );
        }
        const conversion = classifyMojoValueConversion(
          sourceElementType,
          targetType,
          undefined,
          input.projectRelationships,
        );
        if (conversion.kind === "unsupported") {
          return unsupported(
            "MOJO_ARRAY_SPREAD_ELEMENT_CONVERSION_UNPROVEN",
            conversion.reason,
            element,
          );
        }
        const copy = sourceOwnership === "fresh"
          ? false
          : copyRequired(sourceElementType, input.lifecycle);
        if (copy === undefined) {
          return unsupported(
            "MOJO_ARRAY_SPREAD_ELEMENT_COPY_UNPROVEN",
            "Spreading this aggregate requires copying an element whose Mojo carrier is not copyable.",
            element,
          );
        }
        values.push(Object.freeze({
          index,
          sourceType: sourceElementType,
          targetType,
          conversion: conversion.conversion,
          copy,
        }));
        targetIndex += 1;
      }
      contributions.push(Object.freeze({
        kind: "fixed-spread",
        sourceElement: element,
        expression,
        sourceType,
        sourceOwnership,
        values: Object.freeze(values),
      }));
      continue;
    }
    const sequence = sequenceElementType(sourceType);
    if (sequence === undefined || target.kind !== "sequence") {
      return unsupported(
        "MOJO_ARRAY_SPREAD_PROTOCOL_UNSUPPORTED",
        "A variable-length spread requires one exact native List or JavaScript array source and a sequence target.",
        element,
      );
    }
    const conversion = classifyMojoValueConversion(
      sequence.element,
      target.element,
      undefined,
      input.projectRelationships,
    );
    if (conversion.kind === "unsupported") {
      return unsupported(
        "MOJO_ARRAY_SPREAD_ELEMENT_CONVERSION_UNPROVEN",
        conversion.reason,
        element,
      );
    }
    const copy = copyRequired(sequence.element, input.lifecycle);
    if (copy === undefined) {
      return unsupported(
        "MOJO_ARRAY_SPREAD_ELEMENT_COPY_UNPROVEN",
        "Spreading this sequence requires copying an element whose Mojo carrier is not copyable.",
        element,
      );
    }
    contributions.push(Object.freeze({
      kind: "sequence-spread",
      sourceElement: element,
      expression,
      sourceType,
      sourceElementType: sequence.element,
      targetType: target.element,
      conversion: conversion.conversion,
      copy,
      iteration: sequence.iteration,
    }));
  }
  if (target.kind === "fixed" && targetIndex !== target.elements.length) {
    return unsupported(
      "MOJO_ARRAY_LITERAL_TARGET_ARITY_CONFLICT",
      `The selected target aggregate requires ${target.elements.length} values but the literal supplies ${targetIndex}.`,
      input.expression,
    );
  }
  return Object.freeze({
    kind: "resolved",
    selection: Object.freeze({
      expression: input.expression,
      resultType: input.resultType,
      contributions: Object.freeze(contributions),
    }),
  });
}

type TargetShape =
  | { readonly kind: "fixed"; readonly elements: readonly MojoTargetTypeRef[] }
  | { readonly kind: "sequence"; readonly element: MojoTargetTypeRef };

function targetShape(type: MojoTargetTypeRef): TargetShape | undefined {
  if (type.kind === "tuple") return Object.freeze({ kind: "fixed", elements: type.elements });
  if (type.kind === "fixed-array") {
    const length = exactLength(type);
    return length === undefined
      ? undefined
      : Object.freeze({ kind: "fixed", elements: Object.freeze(Array.from({ length }, () => type.element)) });
  }
  if (type.kind === "list") return Object.freeze({ kind: "sequence", element: type.element });
  const jsElement = jsArrayElement(type);
  return jsElement === undefined ? undefined : Object.freeze({ kind: "sequence", element: jsElement });
}

function targetTypeAt(target: TargetShape, index: number): MojoTargetTypeRef | undefined {
  return target.kind === "sequence" ? target.element : target.elements[index];
}

function fixedElementTypes(type: MojoTargetTypeRef): readonly MojoTargetTypeRef[] | undefined {
  if (type.kind === "tuple") return type.elements;
  if (type.kind !== "fixed-array") return undefined;
  const length = exactLength(type);
  return length === undefined ? undefined : Object.freeze(Array.from({ length }, () => type.element));
}

function exactLength(type: Extract<MojoTargetTypeRef, { readonly kind: "fixed-array" }>): number | undefined {
  if (type.length.kind !== "integer") return undefined;
  const length = Number(type.length.value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

function sequenceElementType(type: MojoTargetTypeRef): {
  readonly element: MojoTargetTypeRef;
  readonly iteration: "native" | "js-array";
} | undefined {
  if (type.kind === "list") return Object.freeze({ element: type.element, iteration: "native" });
  const element = jsArrayElement(type);
  return element === undefined ? undefined : Object.freeze({ element, iteration: "js-array" });
}

function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (type.kind !== "target-named" || type.id !== "tsonic.mojo.js.JsArray") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

function copyRequired(
  type: MojoTargetTypeRef,
  lifecycle: MojoLifecycleAnalysis,
): boolean | undefined {
  const capabilities = lifecycle.capabilities(type);
  if (capabilities.registerPassing === "trivial") return false;
  return capabilities.copy === "unavailable" ? undefined : true;
}

function unsupported(
  code: string,
  reason: string,
  node: Node,
): MojoArrayLiteralAnalysis {
  return Object.freeze({ kind: "unsupported", code, reason, node });
}
