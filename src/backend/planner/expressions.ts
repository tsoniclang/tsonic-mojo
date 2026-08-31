import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoValueConversion } from "../../analysis/program/model.js";
import type { MojoExpression } from "../target-ast/nodes.js";
import type { MojoCallArgument } from "../target-ast/nodes.js";
import { appendMojoPlanningDiagnostic } from "./context.js";
import { registerMojoModuleImport } from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import { registerMojoTypeImports } from "./types/render.js";

const binaryOperatorText = new Map<string, string>([
  ["KindPlusToken", "+"],
  ["KindMinusToken", "-"],
  ["KindAsteriskToken", "*"],
  ["KindSlashToken", "/"],
  ["KindPercentToken", "%"],
  ["KindEqualsEqualsEqualsToken", "=="],
  ["KindExclamationEqualsEqualsToken", "!="],
  ["KindLessThanToken", "<"],
  ["KindLessThanEqualsToken", "<="],
  ["KindGreaterThanToken", ">"],
  ["KindGreaterThanEqualsToken", ">="],
  ["KindAmpersandAmpersandToken", "and"],
  ["KindBarBarToken", "or"],
]);

const assignmentOperatorText = new Map<string, string>([
  ["KindEqualsToken", "="],
  ["KindPlusEqualsToken", "+="],
  ["KindMinusEqualsToken", "-="],
  ["KindAsteriskEqualsToken", "*="],
  ["KindSlashEqualsToken", "/="],
]);

export interface PlannedMojoAssignment {
  readonly operator: string;
  readonly left: MojoExpression;
  readonly right: MojoExpression;
}

export function planMojoAssignment(
  node: Node,
  context: MojoPlanningContext,
): PlannedMojoAssignment | undefined {
  const { ast } = context.program.source;
  if (!ast.is.IsBinaryExpression(node)) return undefined;
  const operator = assignmentOperatorText.get(
    ast.kindName(ast.as.AsBinaryExpression(node)?.OperatorToken),
  );
  if (operator === undefined) return undefined;
  const leftNode = BinaryExpression_Left(ast, node);
  const rightNode = BinaryExpression_Right(ast, node);
  if (leftNode === undefined || rightNode === undefined) return undefined;
  const leftType = context.program.queries.expressionType(leftNode);
  const left = planMojoExpression(leftNode, context);
  const right = planMojoExpression(rightNode, context, leftType);
  return left === undefined || right === undefined
    ? undefined
    : Object.freeze({ operator, left, right });
}

export function planMojoExpression(
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
): MojoExpression | undefined {
  const { ast } = context.program.source;
  let planned: MojoExpression | undefined;
  if (ast.is.IsIdentifier(node)) {
    const name = context.program.queries.bindingName(node);
    if (name === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_IDENTIFIER_PLAN_MISSING",
        `Identifier '${ast.text(node)}' has no sealed target binding.`,
        node,
      );
      return undefined;
    }
    planned = { kind: "path", path: name };
  } else if (ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) {
    planned = { kind: "string-literal", value: ast.text(node) };
  } else if (ast.is.IsNumericLiteral(node)) {
    planned = { kind: "number-literal", text: ast.text(node) };
  } else if (ast.kindName(node) === "KindTrueKeyword" || ast.kindName(node) === "KindFalseKeyword") {
    planned = { kind: "bool-literal", value: ast.kindName(node) === "KindTrueKeyword" };
  } else if (ast.is.IsParenthesizedExpression(node)) {
    const inner = Node_Expression(ast, node);
    const expression = inner === undefined ? undefined : planMojoExpression(inner, context, expectedType);
    planned = expression === undefined ? undefined : { kind: "parenthesized", expression };
  } else if (ast.is.IsBinaryExpression(node)) {
    const leftNode = BinaryExpression_Left(ast, node);
    const rightNode = BinaryExpression_Right(ast, node);
    const operator = binaryOperatorText.get(ast.kindName(ast.as.AsBinaryExpression(node)?.OperatorToken));
    const left = leftNode === undefined ? undefined : planMojoExpression(leftNode, context);
    const right = rightNode === undefined ? undefined : planMojoExpression(rightNode, context);
    if (left === undefined || right === undefined || operator === undefined) return undefined;
    planned = { kind: "binary", operator, left, right };
  } else if (ast.is.IsCallExpression(node)) {
    planned = planCall(node, context);
  } else {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_EXPRESSION_PLAN_UNSUPPORTED",
      `Expression kind '${ast.kindName(node)}' reached planning without a Mojo form.`,
      node,
    );
    return undefined;
  }
  if (planned === undefined) return undefined;
  const actualType = context.program.queries.expressionType(node);
  if ((ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) &&
    actualType !== undefined && isJsString(actualType)) {
    registerMojoModuleImport(context, ["tsonic_js"]);
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([{ value: planned }]) };
  }
  return expectedType === undefined || actualType === undefined
    ? planned
    : applyMojoConversion(
        planned,
        requiredConversion(node, expectedType, context),
        context,
      );
}

function planCall(node: Node, context: MojoPlanningContext): MojoExpression | undefined {
  const selection = context.program.queries.callSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(context, "MOJO_CALL_PLAN_MISSING", "Call expression has no sealed target selection.", node);
    return undefined;
  }
  if (selection.kind === "project") {
    const arguments_ = selection.arguments.map((argument) => planSelectedArgument(argument, context));
    if (arguments_.some((argument) => argument === undefined)) return undefined;
    const call: MojoExpression = {
      kind: "call",
      callee: { kind: "path", path: selection.functionName },
      ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
      arguments: Object.freeze(arguments_ as MojoCallArgument[]),
    };
    return applyMojoConversion(call, selection.resultConversion, context);
  }
  const target = selection.operation.target;
  if (target.kind !== "function-call" && target.kind !== "instance-call") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_CALL_FORM_INVALID",
      `Provider call selected non-call target form '${target.kind}'.`,
      node,
    );
    return undefined;
  }
  const arguments_ = selection.arguments.map((argument) => planSelectedArgument(argument, context));
  if (arguments_.some((argument) => argument === undefined)) return undefined;
  let call: MojoExpression;
  if (target.kind === "function-call") {
    registerMojoModuleImport(context, target.modulePath);
    call = {
      kind: "call",
      callee: { kind: "path", path: [...target.modulePath, ...(target.ownerPath ?? []), target.name].join(".") },
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: Object.freeze(arguments_ as MojoCallArgument[]),
    };
  } else if (target.kind === "instance-call") {
    if (selection.receiver === undefined) return undefined;
    const rawReceiver = planMojoExpression(selection.receiver, context);
    const receiver = rawReceiver === undefined || selection.receiverConversion === undefined
      ? rawReceiver
      : applyMojoConversion(rawReceiver, selection.receiverConversion, context);
    if (receiver === undefined) return undefined;
    call = {
      kind: "method-call",
      receiver: target.receiver === "var" || target.receiver === "deinit"
        ? { kind: "consume", expression: receiver }
        : receiver,
      name: target.name,
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: Object.freeze(arguments_ as MojoCallArgument[]),
    };
  } else {
    return undefined;
  }
  return applyMojoConversion(call, selection.resultConversion, context);
}

function planSelectedArgument(
  argument: import("../../analysis/program/model.js").MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
): MojoCallArgument | undefined {
  const expression = planMojoExpression(argument.expression, context);
  if (expression === undefined) return undefined;
  const converted = applyMojoConversion(
    expression,
    argument.conversion,
    context,
  );
  if (converted === undefined) return undefined;
  const value: MojoExpression = argument.passing === "consume"
    ? { kind: "consume", expression: converted }
    : converted;
  return Object.freeze({
    value,
    ...(argument.position === "keyword" ? { name: argument.nativeName! } : {}),
    ...(argument.spread ? { spread: true } : {}),
  });
}

function requiredConversion(
  expression: Node,
  expectedType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoValueConversion | undefined {
  const conversion = context.program.queries.expressionConversion(expression, expectedType);
  if (conversion === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_VALUE_CONVERSION_PLAN_MISSING",
      "Expression use has no sealed Mojo conversion classification.",
      expression,
    );
  }
  return conversion;
}

function applyMojoConversion(
  expression: MojoExpression,
  conversion: MojoValueConversion | undefined,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (conversion === undefined) return undefined;
  switch (conversion.kind) {
    case "identity": return expression;
    case "js-to-native-string":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return { kind: "method-call", receiver: expression, name: "to_native_strict", arguments: Object.freeze([]) };
    case "native-to-js-string":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
    case "primitive-cast":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
  }
}

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}
