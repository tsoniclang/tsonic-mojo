import type { Node } from "@tsonic/tsts";
import {
  TemplateExpression_TemplateSpans,
  TemplateSpan_Expression,
} from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type {
  MojoTemplateExpressionSelection,
  MojoTemplateStringConversion,
} from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoTemplateExpressionAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoTemplateExpressionSelection }
  | { readonly kind: "unsupported"; readonly reason: string; readonly node: Node };

export function analyzeMojoTemplateExpression(
  expression: Node,
  source: TargetSourceProgram,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTemplateExpressionAnalysis {
  const resultType = expressionTypes.get(expression);
  if (resultType === undefined || !isStringType(resultType)) {
    return unsupported(expression, "Template expression has no exact native or JavaScript string result carrier.");
  }
  const spans = TemplateExpression_TemplateSpans(source.ast, expression);
  if (spans === undefined || spans.some((span) => span === undefined)) {
    return unsupported(expression, "Template expression requires one dense authored substitution sequence.");
  }
  const substitutions: MojoTemplateExpressionSelection["substitutions"][number][] = [];
  for (const span of spans as readonly Node[]) {
    const substitution = TemplateSpan_Expression(source.ast, span);
    const type = substitution === undefined ? undefined : expressionTypes.get(substitution);
    const conversion = type === undefined ? undefined : classifyStringification(type, resultType);
    if (substitution === undefined || type === undefined || conversion === undefined) {
      return unsupported(
        substitution ?? span,
        "Template substitution has no exact closed source-string conversion for its selected Mojo carrier.",
      );
    }
    substitutions.push(Object.freeze({ expression: substitution, type, conversion }));
  }
  return Object.freeze({
    kind: "resolved",
    selection: Object.freeze({
      expression,
      resultType,
      substitutions: Object.freeze(substitutions),
    }),
  });
}

function classifyStringification(
  type: MojoTargetTypeRef,
  resultType: MojoTargetTypeRef,
): MojoTemplateStringConversion | undefined {
  if (sameStringDomain(type, resultType)) return Object.freeze({ kind: "identity" });
  if (type.kind === "native-string" && isJsString(resultType)) {
    return Object.freeze({ kind: "native-to-js" });
  }
  if (isJsString(type) && resultType.kind === "native-string") {
    return Object.freeze({ kind: "js-to-native" });
  }
  if (type.kind === "null") return Object.freeze({ kind: "null" });
  if (type.kind === "undefined" || type.kind === "unit") {
    return Object.freeze({ kind: "undefined" });
  }
  if (type.kind === "bigint") return Object.freeze({ kind: "integer" });
  if (type.kind === "source-primitive") {
    if (type.name === "bool") return Object.freeze({ kind: "boolean" });
    if (type.name === "char") return Object.freeze({ kind: "character" });
    if (type.name === "float32" || type.name === "float64") {
      return Object.freeze({ kind: "number" });
    }
    return Object.freeze({ kind: "integer" });
  }
  if (type.kind === "optional") {
    const value = classifyStringification(type.value, resultType);
    return value === undefined
      ? undefined
      : Object.freeze({ kind: "optional", sourceType: type, value });
  }
  if (type.kind === "union") {
    const members = type.members.map((member) => {
      const conversion = classifyStringification(member, resultType);
      return conversion === undefined ? undefined : Object.freeze({ type: member, conversion });
    });
    return members.some((member) => member === undefined)
      ? undefined
      : Object.freeze({
          kind: "union",
          sourceType: type,
          members: Object.freeze(members as readonly {
            readonly type: MojoTargetTypeRef;
            readonly conversion: MojoTemplateStringConversion;
          }[]),
        });
  }
  return undefined;
}

function sameStringDomain(left: MojoTargetTypeRef, right: MojoTargetTypeRef): boolean {
  return left.kind === "native-string" && right.kind === "native-string" ||
    isJsString(left) && isJsString(right);
}

function isStringType(type: MojoTargetTypeRef): boolean {
  return type.kind === "native-string" || isJsString(type);
}

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

function unsupported(node: Node, reason: string): MojoTemplateExpressionAnalysis {
  return Object.freeze({ kind: "unsupported", reason, node });
}
