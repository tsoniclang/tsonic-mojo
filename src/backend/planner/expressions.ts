import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  Node_Expression,
  ObjectLiteralProperty_SourceName,
  ObjectLiteralProperty_Value,
  PrefixUnaryExpression_Operand,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoValueConversion } from "../../analysis/program/model.js";
import type { MojoDictionaryEntry, MojoExpression } from "../target-ast/nodes.js";
import type { MojoCallArgument } from "../target-ast/nodes.js";
import { appendMojoPlanningDiagnostic } from "./context.js";
import { registerMojoModuleImport } from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import { mojoTypeName, registerMojoTypeImports } from "./types/render.js";

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
  ["KindAsteriskAsteriskToken", "**"],
  ["KindAmpersandToken", "&"],
  ["KindBarToken", "|"],
  ["KindCaretToken", "^"],
  ["KindLessThanLessThanToken", "<<"],
  ["KindGreaterThanGreaterThanToken", ">>"],
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

export function planMojoUpdate(
  node: Node,
  context: MojoPlanningContext,
): PlannedMojoAssignment | undefined {
  const { ast } = context.program.source;
  if (!ast.is.IsPrefixUnaryExpression(node) && !ast.is.IsPostfixUnaryExpression(node)) return undefined;
  const operatorKind = ast.operatorKindName(node);
  const operator = operatorKind === "KindPlusPlusToken"
    ? "+="
    : operatorKind === "KindMinusMinusToken"
      ? "-="
      : undefined;
  if (operator === undefined) return undefined;
  const operand = ast.is.IsPrefixUnaryExpression(node)
    ? ast.as.AsPrefixUnaryExpression(node)?.Operand
    : ast.as.AsPostfixUnaryExpression(node)?.Operand;
  if (operand === undefined) return undefined;
  const property = context.program.queries.propertySelection(operand);
  const element = context.program.queries.elementSelection(operand);
  const left = ast.is.IsPropertyAccessExpression(operand)
    ? planProperty(operand, context, "write")
    : ast.is.IsElementAccessExpression(operand)
      ? planElement(operand, context, "write")
      : planMojoExpression(operand, context);
  const type = property?.kind === "provider"
    ? property.writeOperation?.parameterTypes[0]
    : element?.writeType ?? context.program.queries.expressionType(operand);
  if (left === undefined || type === undefined || type.kind !== "source-primitive" ||
    type.name === "bool" || type.name === "char") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_UPDATE_TARGET_UNSUPPORTED",
      "Increment and decrement require one exact mutable numeric Mojo location.",
      node,
    );
    return undefined;
  }
  return Object.freeze({
    operator,
    left,
    right: Object.freeze({ kind: "number-literal", text: "1" }),
  });
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
  const property = context.program.queries.propertySelection(leftNode);
  const element = context.program.queries.elementSelection(leftNode);
  const writeType = property?.kind === "provider"
    ? property.writeOperation?.parameterTypes[0]
    : element?.writeType;
  const left = ast.is.IsPropertyAccessExpression(leftNode)
    ? planProperty(leftNode, context, "write")
    : ast.is.IsElementAccessExpression(leftNode)
      ? planElement(leftNode, context, "write")
      : planMojoExpression(leftNode, context);
  const right = planMojoExpression(rightNode, context, writeType ?? leftType);
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
  if (ast.is.IsIdentifier(node) || ast.kindName(node) === "KindThisKeyword") {
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
  } else if (ast.kindName(node) === "KindNullKeyword" || ast.kindName(node) === "KindUndefinedKeyword") {
    const type = context.program.queries.expressionType(node);
    if (type === undefined || (type.kind !== "null" && type.kind !== "undefined")) return undefined;
    registerMojoTypeImports(type, context);
    planned = { kind: "construct", type, arguments: Object.freeze([]) };
  } else if (ast.is.IsArrayLiteralExpression(node)) {
    planned = planArrayLiteral(node, context);
  } else if (ast.is.IsObjectLiteralExpression(node)) {
    planned = planObjectLiteral(node, context);
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
  } else if (ast.is.IsPrefixUnaryExpression(node)) {
    const operandNode = PrefixUnaryExpression_Operand(ast, node);
    const operator = prefixOperator(ast.operatorKindName(node));
    const operand = operandNode === undefined ? undefined : planMojoExpression(operandNode, context);
    if (operator === undefined || operand === undefined) return undefined;
    planned = { kind: "unary", operator, operand };
  } else if (ast.is.IsConditionalExpression(node)) {
    const conditionNode = ConditionalExpression_Condition(ast, node);
    const trueNode = ConditionalExpression_WhenTrue(ast, node);
    const falseNode = ConditionalExpression_WhenFalse(ast, node);
    const resultType = context.program.queries.expressionType(node);
    const condition = conditionNode === undefined
      ? undefined
      : planMojoExpression(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const whenTrue = trueNode === undefined ? undefined : planMojoExpression(trueNode, context, resultType);
    const whenFalse = falseNode === undefined ? undefined : planMojoExpression(falseNode, context, resultType);
    if (condition === undefined || whenTrue === undefined || whenFalse === undefined) return undefined;
    planned = { kind: "conditional", condition, whenTrue, whenFalse };
  } else if (ast.is.IsAwaitExpression(node)) {
    const inner = Node_Expression(ast, node);
    const expression = inner === undefined ? undefined : planMojoExpression(inner, context);
    if (expression === undefined) return undefined;
    planned = { kind: "await", expression };
  } else if (ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) ||
    ast.is.IsNonNullExpression(node) || ast.is.IsSatisfiesExpression(node)) {
    const inner = Node_Expression(ast, node);
    const expression = inner === undefined ? undefined : planMojoExpression(inner, context, actualExpressionType(node, context));
    if (expression === undefined) return undefined;
    planned = expression;
  } else if (ast.is.IsCallExpression(node)) {
    planned = planCall(node, context);
  } else if (ast.is.IsNewExpression(node)) {
    planned = planCall(node, context);
  } else if (ast.is.IsPropertyAccessExpression(node)) {
    planned = planProperty(node, context, "read");
  } else if (ast.is.IsElementAccessExpression(node)) {
    planned = planElement(node, context, "read");
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

function planArrayLiteral(node: Node, context: MojoPlanningContext): MojoExpression | undefined {
  const type = context.program.queries.expressionType(node);
  if (type === undefined) return undefined;
  const sourceElements = context.program.source.ast.elements(node);
  if (sourceElements.some((element) => element === undefined || context.program.source.ast.is.IsSpreadElement(element))) {
    appendMojoPlanningDiagnostic(context, "MOJO_ARRAY_SPREAD_PLAN_UNSUPPORTED", "Array spread requires a sealed expansion plan.", node);
    return undefined;
  }
  const expected = type.kind === "list" || type.kind === "fixed-array"
    ? sourceElements.map(() => type.element)
    : type.kind === "tuple"
      ? type.elements
      : isJsArray(type)
        ? sourceElements.map(() => jsArrayElement(type)!)
        : undefined;
  if (expected === undefined || expected.length !== sourceElements.length || expected.some((entry) => entry === undefined)) {
    appendMojoPlanningDiagnostic(context, "MOJO_ARRAY_LITERAL_TYPE_UNSUPPORTED", "Array literal has no exact Mojo element carrier list.", node);
    return undefined;
  }
  const elements = (sourceElements as readonly Node[]).map((element, index) =>
    planMojoExpression(element, context, expected[index]));
  if (elements.some((element) => element === undefined)) return undefined;
  const literal: MojoExpression = type.kind === "tuple"
    ? { kind: "tuple", elements: Object.freeze(elements as MojoExpression[]) }
    : { kind: "list", elements: Object.freeze(elements as MojoExpression[]) };
  if (type.kind === "fixed-array") {
    registerMojoTypeImports(type, context);
    return {
      kind: "construct",
      type,
      arguments: Object.freeze((elements as MojoExpression[]).map((value) => ({ value }))),
    };
  }
  if (isJsArray(type)) {
    registerMojoTypeImports(type, context);
    return { kind: "construct", type, arguments: Object.freeze([{ value: literal }]) };
  }
  return literal;
}

function planObjectLiteral(node: Node, context: MojoPlanningContext): MojoExpression | undefined {
  const type = context.program.queries.expressionType(node);
  if (type?.kind !== "dictionary") {
    appendMojoPlanningDiagnostic(context, "MOJO_OBJECT_LITERAL_SHAPE_UNSUPPORTED", "Object literal has no sealed dictionary or project-object representation.", node);
    return undefined;
  }
  const entries: MojoDictionaryEntry[] = [];
  for (const property of context.program.source.ast.properties(node)) {
    if (property === undefined ||
      (!context.program.source.ast.is.IsPropertyAssignment(property) &&
        !context.program.source.ast.is.IsShorthandPropertyAssignment(property))) return undefined;
    const name = ObjectLiteralProperty_SourceName(context.program.source.ast, property);
    const valueNode = ObjectLiteralProperty_Value(context.program.source.ast, property);
    if (name.kind !== "resolved" || valueNode === undefined) return undefined;
    const value = planMojoExpression(valueNode, context, type.value);
    const key = planDictionaryKey(name.name, type.key, context);
    if (value === undefined || key === undefined) return undefined;
    entries.push(Object.freeze({ key, value }));
  }
  return { kind: "dictionary", entries: Object.freeze(entries) };
}

function planDictionaryKey(
  value: string,
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const literal: MojoExpression = { kind: "string-literal", value };
  if (type.kind === "native-string") return literal;
  if (isJsString(type)) {
    registerMojoTypeImports(type, context);
    return { kind: "construct", type, arguments: Object.freeze([{ value: literal }]) };
  }
  return undefined;
}

function prefixOperator(kind: string | undefined): string | undefined {
  switch (kind) {
    case "KindPlusToken": return "+";
    case "KindMinusToken": return "-";
    case "KindExclamationToken": return "not";
    case "KindTildeToken": return "~";
    default: return undefined;
  }
}

function actualExpressionType(node: Node, context: MojoPlanningContext): MojoTargetTypeRef | undefined {
  return context.program.queries.expressionType(node);
}

function isJsArray(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray";
}

function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isJsArray(type) || type.kind !== "target-named") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

function planElement(
  node: Node,
  context: MojoPlanningContext,
  mode: "read" | "write",
): MojoExpression | undefined {
  const selection = context.program.queries.elementSelection(node);
  if (selection === undefined || (mode === "read" ? selection.readType : selection.writeType) === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ELEMENT_PLAN_MISSING",
      `Element access has no sealed ${mode} selection.`,
      node,
    );
    return undefined;
  }
  const receiver = planMojoExpression(selection.receiver, context);
  const rawIndex = planMojoExpression(selection.index, context);
  const index = rawIndex === undefined
    ? undefined
    : applyMojoConversion(rawIndex, selection.indexConversion, context);
  if (receiver === undefined || index === undefined) return undefined;
  const access: MojoExpression = { kind: "element", receiver, index };
  return mode === "read" && selection.readResultConversion !== undefined
    ? applyMojoConversion(access, selection.readResultConversion, context)
    : access;
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
    const selectedArguments = Object.freeze(arguments_ as MojoCallArgument[]);
    let call: MojoExpression;
    switch (selection.target.kind) {
      case "function":
        call = {
          kind: "call",
          callee: { kind: "path", path: selection.target.name },
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: selectedArguments,
        };
        break;
      case "method": {
        const receiver = planMojoExpression(selection.target.receiver, context);
        if (receiver === undefined) return undefined;
        call = {
          kind: "method-call",
          receiver,
          name: selection.target.name,
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: selectedArguments,
        };
        break;
      }
      case "static-method":
        registerMojoTypeImports(selection.target.owner, context);
        call = {
          kind: "method-call",
          receiver: { kind: "path", path: requiredMojoTypeName(selection.target.owner) },
          name: selection.target.name,
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: selectedArguments,
        };
        break;
      case "constructor":
        registerMojoTypeImports(selection.target.type, context);
        call = {
          kind: "construct",
          type: selection.target.type,
          arguments: selectedArguments,
        };
        break;
    }
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

function planProperty(
  node: Node,
  context: MojoPlanningContext,
  mode: "read" | "write",
): MojoExpression | undefined {
  const selection = context.program.queries.propertySelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROPERTY_PLAN_MISSING",
      "Property access has no sealed target selection.",
      node,
    );
    return undefined;
  }
  const receiver = planMojoExpression(selection.receiver, context);
  if (receiver === undefined) return undefined;
  if (selection.kind === "project-field") {
    return {
      kind: "member",
      receiver: {
        kind: "postfix-deref",
        expression: { kind: "member", receiver, name: "_state" },
      },
      name: selection.fieldName,
    };
  }
  const operation = mode === "read" ? selection.readOperation : selection.writeOperation;
  if (operation === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_PROPERTY_ACCESS_MODE_MISSING",
      `Provider property has no sealed ${mode} operation.`,
      node,
    );
    return undefined;
  }
  const target = operation.target;
  if ((mode === "read" && target.kind !== "property-read") ||
    (mode === "write" && target.kind !== "property-write")) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_PROPERTY_FORM_INVALID",
      `Provider property ${mode} selected target form '${target.kind}'.`,
      node,
    );
    return undefined;
  }
  const convertedReceiver = selection.receiverConversion === undefined
    ? receiver
    : applyMojoConversion(receiver, selection.receiverConversion, context);
  if (convertedReceiver === undefined) return undefined;
  const member: MojoExpression = { kind: "member", receiver: convertedReceiver, name: target.name };
  return mode === "read" && selection.readResultConversion !== undefined
    ? applyMojoConversion(member, selection.readResultConversion, context)
    : member;
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

function requiredMojoTypeName(type: MojoTargetTypeRef): string {
  const name = mojoTypeName(type);
  if (name === undefined) throw new Error("A Mojo unit type cannot own a static method.");
  return name;
}
