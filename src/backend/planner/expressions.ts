import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
} from "@tsonic/target-api/source";
import { mojoTypeEquals } from "../../analysis/types/resolution.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoExpression } from "../target-ast/nodes.js";
import { appendMojoPlanningDiagnostic } from "./context.js";
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
    context.imports.add("tsonic_js");
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([planned]) };
  }
  return expectedType === undefined || actualType === undefined
    ? planned
    : convertMojoExpression(planned, actualType, expectedType, context, node);
}

function planCall(node: Node, context: MojoPlanningContext): MojoExpression | undefined {
  const selection = context.program.queries.callSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(context, "MOJO_CALL_PLAN_MISSING", "Call expression has no sealed target selection.", node);
    return undefined;
  }
  const sourceArguments = context.program.source.ast.arguments(node);
  if (sourceArguments.some((argument) => argument === undefined)) return undefined;
  if (selection.kind === "project") {
    if (sourceArguments.length !== selection.parameterTypes.length) return undefined;
    const arguments_ = (sourceArguments as readonly Node[]).map((argument, index) =>
      planMojoExpression(argument, context, selection.parameterTypes[index]));
    if (arguments_.some((argument) => argument === undefined)) return undefined;
    return {
      kind: "call",
      callee: { kind: "path", path: selection.functionName },
      arguments: Object.freeze(arguments_ as MojoExpression[]),
    };
  }
  const parameterTypes = selection.operation.parameterTypes ?? [];
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
  const arguments_: MojoExpression[] = [];
  for (const [index, argument] of selection.arguments.entries()) {
    const expected = parameterTypes[index];
    const planned = expected === undefined ? undefined : planMojoExpression(argument, context, expected);
    if (planned === undefined) return undefined;
    const convention = target.arguments[index];
    arguments_.push(convention === "transfer" ? { kind: "consume", expression: planned } : planned);
  }
  let call: MojoExpression;
  if (target.kind === "function-call") {
    if (target.modulePath.length > 0) context.imports.add(target.modulePath.join("."));
    call = {
      kind: "call",
      callee: { kind: "path", path: [...target.modulePath, target.name].join(".") },
      arguments: Object.freeze(arguments_),
    };
  } else if (target.kind === "instance-call") {
    if (selection.receiver === undefined) return undefined;
    const receiver = planMojoExpression(selection.receiver, context, selection.operation.receiverType);
    if (receiver === undefined) return undefined;
    call = {
      kind: "method-call",
      receiver: target.receiver === "transfer" ? { kind: "consume", expression: receiver } : receiver,
      name: target.name,
      arguments: Object.freeze(arguments_),
    };
  } else {
    return undefined;
  }
  const sourceType = context.program.queries.expressionType(node);
  return sourceType === undefined
    ? call
    : convertMojoExpression(call, selection.operation.resultType, sourceType, context, node);
}

function convertMojoExpression(
  expression: MojoExpression,
  actual: MojoTargetTypeRef,
  expected: MojoTargetTypeRef,
  context: MojoPlanningContext,
  sourceNode: Node,
): MojoExpression | undefined {
  if (mojoTypeEquals(actual, expected)) return expression;
  if (isJsString(actual) && expected.kind === "native-string") {
    context.imports.add("tsonic_js");
    return { kind: "method-call", receiver: expression, name: "to_native_strict", arguments: Object.freeze([]) };
  }
  if (actual.kind === "native-string" && isJsString(expected)) {
    context.imports.add("tsonic_js");
    return { kind: "construct", type: expected, arguments: Object.freeze([expression]) };
  }
  if (actual.kind === "source-primitive" && expected.kind === "source-primitive") {
    registerMojoTypeImports(expected, context);
    return { kind: "construct", type: expected, arguments: Object.freeze([expression]) };
  }
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_VALUE_CONVERSION_UNPROVEN",
    `No exact Mojo value conversion exists from '${JSON.stringify(actual)}' to '${JSON.stringify(expected)}'.`,
    sourceNode,
  );
  return undefined;
}

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}
