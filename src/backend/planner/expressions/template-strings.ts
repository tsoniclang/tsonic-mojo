import type { Node } from "@tsonic/tsts";
import {
  TemplateExpression_Head,
  TemplateExpression_TemplateSpans,
  TemplateSpan_Literal,
} from "@tsonic/target-api/source";
import type {
  MojoTemplateStringConversion,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoTemplateExpression(
  expression: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.templateExpressionSelection(expression);
  const head = TemplateExpression_Head(context.program.source.ast, expression);
  const spans = TemplateExpression_TemplateSpans(context.program.source.ast, expression);
  if (selection === undefined || head === undefined || spans === undefined ||
    spans.some((span) => span === undefined) || spans.length !== selection.substitutions.length) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_TEMPLATE_PLAN_MISSING",
      "Template expression has no exact sealed substitution and source-string plan.",
      expression,
    );
    return undefined;
  }
  const planned = selection.substitutions.map((substitution) => {
    const value = planValue(substitution.expression, context);
    if (value === undefined) return undefined;
    const selected = substitution.conversion.kind === "optional" || substitution.conversion.kind === "union"
      ? orderMojoValues([Object.freeze({
          plan: value,
          type: substitution.type,
          role: "template_value",
        })], context, true)
      : Object.freeze({ before: value.before, values: Object.freeze([value.value]) });
    const converted = planStringification(
      selected.values[0]!,
      substitution.type,
      substitution.conversion,
      selection.resultType,
      context,
    );
    return converted === undefined ? undefined : withMojoValue(selected.before, converted);
  });
  if (planned.some((value) => value === undefined)) return undefined;
  const ordered = orderMojoValues(
    (planned as readonly MojoValuePlan[]).map((value) => Object.freeze({
      plan: value,
      type: selection.resultType,
      role: "template_substitution",
    })),
    context,
  );
  const headText = context.program.source.ast.text(head);
  let result: MojoExpression | undefined = headText.length === 0
    ? undefined
    : stringLiteral(headText, selection.resultType, context);
  if (headText.length !== 0 && result === undefined) return undefined;
  for (const [index, span] of (spans as readonly Node[]).entries()) {
    const converted = ordered.values[index]!;
    const literal = TemplateSpan_Literal(context.program.source.ast, span);
    if (literal === undefined) return undefined;
    result = result === undefined ? converted : concatenate(result, converted);
    const tailText = context.program.source.ast.text(literal);
    if (tailText.length !== 0) {
      const tail = stringLiteral(tailText, selection.resultType, context);
      if (tail === undefined) return undefined;
      result = concatenate(result, tail);
    }
  }
  return result === undefined ? undefined : withMojoValue(ordered.before, result);
}

function planStringification(
  expression: MojoExpression,
  sourceType: MojoTargetTypeRef,
  conversion: MojoTemplateStringConversion,
  resultType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  switch (conversion.kind) {
    case "identity": return expression;
    case "native-to-js":
      registerMojoTypeImports(resultType, context);
      return Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([{ value: expression }]),
      });
    case "js-to-native": return Object.freeze({
      kind: "method-call",
      receiver: expression,
      name: "to_native_strict",
      arguments: Object.freeze([]),
    });
    case "boolean":
      return isJsString(resultType)
        ? jsStringCall("boolean_to_string", expression, context)
        : nativeString(expression);
    case "number":
      return isJsString(resultType)
        ? jsStringCall(
            "number_to_string",
            sourceType.kind === "source-primitive" && sourceType.name === "float32"
              ? Object.freeze({
                  kind: "construct",
                  type: Object.freeze({ kind: "source-primitive", name: "float64" }),
                  arguments: Object.freeze([{ value: expression }]),
                })
              : expression,
            context,
          )
        : nativeString(expression);
    case "integer":
    case "character":
      return isJsString(resultType)
        ? wrapNativeString(nativeString(expression), resultType, context)
        : nativeString(expression);
    case "native-error":
      return isJsString(resultType)
        ? wrapNativeString(nativeString(expression), resultType, context)
        : nativeString(expression);
    case "js-dynamic": {
      const converted = jsStringCall("js_value_to_string", expression, context);
      return isJsString(resultType)
        ? converted
        : Object.freeze({
            kind: "method-call",
            receiver: converted,
            name: "to_native_strict",
            arguments: Object.freeze([]),
          });
    }
    case "null": return stringLiteral("null", resultType, context);
    case "undefined": return stringLiteral("undefined", resultType, context);
    case "optional": {
      const present = planStringification(
        Object.freeze({
          kind: "method-call",
          receiver: expression,
          name: "value",
          arguments: Object.freeze([]),
        }),
        conversion.sourceType.value,
        conversion.value,
        resultType,
        context,
      );
      const absent = stringLiteral("undefined", resultType, context);
      return present === undefined || absent === undefined
        ? undefined
        : Object.freeze({
            kind: "conditional",
            condition: Object.freeze({
              kind: "construct",
              type: Object.freeze({ kind: "source-primitive", name: "bool" }),
              arguments: Object.freeze([{ value: expression }]),
            }),
            whenTrue: present,
            whenFalse: absent,
          });
    }
    case "union": {
      let result: MojoExpression | undefined;
      for (let index = conversion.members.length - 1; index >= 0; index -= 1) {
        const member = conversion.members[index]!;
        registerMojoTypeImports(member.type, context);
        const selected = planStringification(
          Object.freeze({ kind: "proven-union-member", receiver: expression, type: member.type }),
          member.type,
          member.conversion,
          resultType,
          context,
        );
        if (selected === undefined) return undefined;
        result = result === undefined
          ? selected
          : Object.freeze({
              kind: "conditional",
              condition: Object.freeze({
                kind: "method-call",
                receiver: expression,
                name: "isa",
                genericArguments: Object.freeze([{ kind: "type" as const, type: member.type }]),
                arguments: Object.freeze([]),
              }),
              whenTrue: selected,
              whenFalse: result,
            });
      }
      return result;
    }
  }
}

function jsStringCall(
  name: string,
  value: MojoExpression,
  context: MojoPlanningContext,
): MojoExpression {
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, ["tsonic_js"], name),
    arguments: Object.freeze([{ value }]),
  });
}

function nativeString(value: MojoExpression): MojoExpression {
  return Object.freeze({
    kind: "construct",
    type: Object.freeze({ kind: "native-string" }),
    arguments: Object.freeze([{ value }]),
  });
}

function wrapNativeString(
  value: MojoExpression,
  resultType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression {
  registerMojoTypeImports(resultType, context);
  return Object.freeze({
    kind: "construct",
    type: resultType,
    arguments: Object.freeze([{ value }]),
  });
}

function stringLiteral(
  value: string,
  resultType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const literal: MojoExpression = Object.freeze({ kind: "string-literal", value });
  if (resultType.kind === "native-string") return literal;
  return isJsString(resultType) ? wrapNativeString(literal, resultType, context) : undefined;
}

function concatenate(left: MojoExpression, right: MojoExpression): MojoExpression {
  return Object.freeze({ kind: "binary", operator: "+", left, right });
}

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}
