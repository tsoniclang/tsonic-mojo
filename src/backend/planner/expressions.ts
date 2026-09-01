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
import { mojoTargetTypeEquals } from "../../target-model/provider/equality.js";
import type {
  MojoDictionaryEntry,
  MojoExpression,
  MojoStatement,
} from "../target-ast/nodes.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  registerMojoSymbolImport,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import {
  planMojoCall,
  planMojoElement,
  planMojoProperty,
} from "./expression-operations.js";
import { planMojoLeafExpression } from "./expression-leaves.js";
import {
  applyMojoConversion,
  isJsString,
  orderMojoValues,
  requiredConversion,
} from "./expression-support.js";
import type { OrderedMojoValue } from "./expression-support.js";
import { registerMojoTypeImports } from "./types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoProjectObjectLiteral } from "./object-literals.js";

const binaryOperatorText = new Map<string, string>([
  ["KindPlusToken", "+"], ["KindMinusToken", "-"], ["KindAsteriskToken", "*"],
  ["KindSlashToken", "/"], ["KindPercentToken", "%"], ["KindEqualsEqualsEqualsToken", "=="],
  ["KindExclamationEqualsEqualsToken", "!="], ["KindLessThanToken", "<"],
  ["KindLessThanEqualsToken", "<="], ["KindGreaterThanToken", ">"],
  ["KindGreaterThanEqualsToken", ">="], ["KindAmpersandAmpersandToken", "and"],
  ["KindBarBarToken", "or"], ["KindAsteriskAsteriskToken", "**"],
  ["KindAmpersandToken", "&"], ["KindBarToken", "|"], ["KindCaretToken", "^"],
  ["KindLessThanLessThanToken", "<<"], ["KindGreaterThanGreaterThanToken", ">>"],
]);

const assignmentOperatorText = new Map<string, string>([
  ["KindEqualsToken", "="],
  ["KindPlusEqualsToken", "+="],
  ["KindMinusEqualsToken", "-="],
  ["KindAsteriskEqualsToken", "*="],
  ["KindSlashEqualsToken", "/="],
]);

export interface PlannedMojoAssignment {
  readonly before: readonly MojoStatement[];
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
    ? planMojoProperty(operand, context, planMojoValue, "write", false)
    : ast.is.IsElementAccessExpression(operand)
      ? planMojoElement(operand, context, planMojoValue, "write", false)
      : planMojoValue(operand, context);
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
    before: left.before,
    operator,
    left: left.value,
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
  const targetType = writeType ?? leftType;
  const right = planMojoValue(rightNode, context, targetType);
  if (right === undefined) return undefined;
  const stabilizeLocation = right.before.length !== 0;
  const left = ast.is.IsPropertyAccessExpression(leftNode)
    ? planMojoProperty(leftNode, context, planMojoValue, "write", stabilizeLocation)
    : ast.is.IsElementAccessExpression(leftNode)
      ? planMojoElement(leftNode, context, planMojoValue, "write", stabilizeLocation)
      : planMojoValue(leftNode, context);
  if (left === undefined) return undefined;
  const before: MojoStatement[] = [...left.before];
  let plannedOperator = operator;
  let plannedRight = right.value;
  if (operator !== "=" && right.before.length !== 0) {
    if (targetType === undefined) return undefined;
    registerMojoTypeImports(targetType, context);
    const priorName = allocateMojoSyntheticName(context, "compound_left");
    const priorValue: MojoExpression = Object.freeze({ kind: "path", path: priorName });
    before.push(Object.freeze({
      kind: "variable",
      name: priorName,
      type: targetType,
      initializer: left.value,
    }));
    plannedOperator = "=";
    plannedRight = Object.freeze({
      kind: "binary",
      operator: operator.slice(0, -1),
      left: priorValue,
      right: right.value,
    });
  }
  before.push(...right.before);
  return Object.freeze({
    before: Object.freeze(before),
    operator: plannedOperator,
    left: left.value,
    right: plannedRight,
  });
}

export function planMojoExpression(
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
): MojoExpression | undefined {
  const plan = planMojoValue(node, context, expectedType);
  if (plan === undefined) return undefined;
  if (plan.before.length !== 0) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_VALUE_REGION_NOT_ADMITTED",
      "This expression context cannot admit the sealed evaluation-region statements.",
      node,
    );
    return undefined;
  }
  return plan.value;
}

export function planMojoValue(
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
): MojoValuePlan | undefined {
  const { ast } = context.program.source;
  let plan: MojoValuePlan | undefined;
  if (ast.is.IsArrayLiteralExpression(node)) {
    plan = planArrayLiteral(node, context);
  } else if (ast.is.IsObjectLiteralExpression(node)) {
    plan = planObjectLiteral(node, context);
  } else if (ast.is.IsParenthesizedExpression(node)) {
    plan = planParenthesized(node, context);
  } else if (ast.is.IsBinaryExpression(node)) {
    plan = planBinary(node, context);
  } else if (ast.is.IsPrefixUnaryExpression(node)) {
    plan = planPrefixUnary(node, context);
  } else if (ast.is.IsConditionalExpression(node)) {
    plan = planConditional(node, context);
  } else if (ast.is.IsAwaitExpression(node)) {
    plan = planAwait(node, context);
  } else if (ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) ||
    ast.is.IsNonNullExpression(node) || ast.is.IsSatisfiesExpression(node)) {
    plan = planErasedExpression(node, context);
  } else if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
    plan = planMojoCall(node, context, planMojoValue);
  } else if (ast.is.IsPropertyAccessExpression(node)) {
    plan = planMojoProperty(node, context, planMojoValue, "read");
  } else if (ast.is.IsElementAccessExpression(node)) {
    plan = planMojoElement(node, context, planMojoValue, "read");
  } else {
    const expression = planMojoLeafExpression(node, context);
    plan = expression === undefined ? undefined : mojoValue(expression);
  }
  if (plan === undefined) return undefined;
  const actualType = context.program.queries.expressionType(node);
  if (expectedType === undefined || actualType === undefined) return plan;
  const conversion = requiredConversion(node, expectedType, context);
  if (conversion === undefined) return undefined;
  const converted = applyMojoConversion(plan.value, conversion, context);
  return converted === undefined ? undefined : Object.freeze({ before: plan.before, value: converted });
}

function planArrayLiteral(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
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
  const elementPlans = (sourceElements as readonly Node[]).map((element, index) =>
    planMojoValue(element, context, expected[index]));
  if (elementPlans.some((element) => element === undefined)) return undefined;
  const ordered = orderMojoValues(
    (elementPlans as MojoValuePlan[]).map((plan, index) => ({
      plan,
      type: expected[index]!,
      role: "array_element",
    })),
    context,
  );
  const before = ordered.before;
  const elements = ordered.values;
  const literal: MojoExpression = type.kind === "tuple"
    ? { kind: "tuple", elements: Object.freeze(elements as MojoExpression[]) }
    : { kind: "list", elements: Object.freeze(elements as MojoExpression[]) };
  if (type.kind === "fixed-array") {
    registerMojoTypeImports(type, context);
    return withMojoValue(before, {
      kind: "construct",
      type,
      arguments: Object.freeze(elements.map((value) => ({ value }))),
    });
  }
  if (isJsArray(type)) {
    registerMojoTypeImports(type, context);
    return withMojoValue(before, { kind: "construct", type, arguments: Object.freeze([{ value: literal }]) });
  }
  return withMojoValue(before, literal);
}

function planObjectLiteral(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const project = planMojoProjectObjectLiteral(node, context, planMojoValue);
  if (project !== undefined) return project;
  const type = context.program.queries.expressionType(node);
  if (type?.kind !== "dictionary") {
    appendMojoPlanningDiagnostic(context, "MOJO_OBJECT_LITERAL_SHAPE_UNSUPPORTED", "Object literal has no sealed dictionary or project-object representation.", node);
    return undefined;
  }
  const keys: MojoExpression[] = [];
  const values: OrderedMojoValue[] = [];
  for (const property of context.program.source.ast.properties(node)) {
    if (property === undefined ||
      (!context.program.source.ast.is.IsPropertyAssignment(property) &&
        !context.program.source.ast.is.IsShorthandPropertyAssignment(property))) return undefined;
    const name = ObjectLiteralProperty_SourceName(context.program.source.ast, property);
    const valueNode = ObjectLiteralProperty_Value(context.program.source.ast, property);
    if (name.kind !== "resolved" || valueNode === undefined) return undefined;
    const value = planMojoValue(valueNode, context, type.value);
    const key = planDictionaryKey(name.name, type.key, context);
    if (value === undefined || key === undefined) return undefined;
    keys.push(key);
    values.push(Object.freeze({ plan: value, type: type.value, role: "dictionary_value" }));
  }
  const ordered = orderMojoValues(values, context);
  const entries: MojoDictionaryEntry[] = ordered.values.map((value, index) => Object.freeze({
    key: keys[index]!,
    value,
  }));
  return withMojoValue(ordered.before, { kind: "dictionary", entries: Object.freeze(entries) });
}

function planParenthesized(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const inner = Node_Expression(context.program.source.ast, node);
  const plan = inner === undefined ? undefined : planMojoValue(inner, context);
  return plan === undefined
    ? undefined
    : withMojoValue(plan.before, { kind: "parenthesized", expression: plan.value });
}

function planBinary(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const { ast } = context.program.source;
  const leftNode = BinaryExpression_Left(ast, node);
  const rightNode = BinaryExpression_Right(ast, node);
  const operatorKind = ast.kindName(ast.as.AsBinaryExpression(node)?.OperatorToken);
  if (operatorKind === "KindQuestionQuestionToken") {
    return planNullishCoalescing(node, leftNode, rightNode, context);
  }
  const operator = binaryOperatorText.get(operatorKind);
  const resultType = context.program.queries.expressionType(node);
  const [leftExpected, rightExpected] = binaryOperandTypes(
    operatorKind,
    leftNode,
    rightNode,
    resultType,
    context,
  );
  const left = leftNode === undefined ? undefined : planMojoValue(leftNode, context, leftExpected);
  const right = rightNode === undefined ? undefined : planMojoValue(rightNode, context, rightExpected);
  if (left === undefined || right === undefined || operator === undefined) return undefined;
  if ((operatorKind !== "KindAmpersandAmpersandToken" && operatorKind !== "KindBarBarToken") ||
    right.before.length === 0) {
    const leftType = leftExpected ?? (leftNode === undefined ? undefined : context.program.queries.expressionType(leftNode));
    const rightType = rightExpected ?? (rightNode === undefined ? undefined : context.program.queries.expressionType(rightNode));
    if (leftType === undefined || rightType === undefined) return undefined;
    const ordered = orderMojoValues([
      Object.freeze({ plan: left, type: leftType, role: "binary_left" }),
      Object.freeze({ plan: right, type: rightType, role: "binary_right" }),
    ], context);
    return withMojoValue(ordered.before, {
      kind: "binary",
      operator,
      left: ordered.values[0]!,
      right: ordered.values[1]!,
    });
  }
  if (resultType === undefined) return undefined;
  registerMojoTypeImports(resultType, context);
  const resultName = allocateMojoSyntheticName(context, "logical_value");
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const branchCondition: MojoExpression = operatorKind === "KindAmpersandAmpersandToken"
    ? resultPath
    : Object.freeze({ kind: "unary", operator: "not", operand: resultPath });
  return withMojoValue([
    ...left.before,
    Object.freeze({ kind: "variable", name: resultName, type: resultType, initializer: left.value }),
    Object.freeze({
      kind: "if",
      condition: branchCondition,
      thenStatements: Object.freeze([
        ...right.before,
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: right.value }),
      ]),
    }),
  ], resultPath);
}

function planNullishCoalescing(
  node: Node,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (leftNode === undefined || rightNode === undefined) return undefined;
  const leftType = context.program.queries.expressionType(leftNode);
  const resultType = context.program.queries.expressionType(node);
  const left = planMojoValue(leftNode, context);
  const right = planMojoValue(rightNode, context, resultType);
  if (leftType === undefined || resultType === undefined || left === undefined || right === undefined) {
    return undefined;
  }
  if (leftType.kind === "null" || leftType.kind === "undefined") {
    return withMojoValue([
      ...left.before,
      Object.freeze({ kind: "expression", expression: left.value }),
      ...right.before,
    ], right.value);
  }
  if (leftType.kind !== "optional" || !mojoTargetTypeEquals(leftType.value, resultType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_NULLISH_COALESCING_CARRIER_UNSUPPORTED",
      "Nullish coalescing requires one exact Optional[T] left carrier and the same closed T result carrier.",
      node,
    );
    return undefined;
  }
  registerMojoTypeImports(leftType, context);
  registerMojoTypeImports(resultType, context);
  const optionalName = allocateMojoSyntheticName(context, "nullish_source");
  const resultName = allocateMojoSyntheticName(context, "nullish_value");
  const optionalPath: MojoExpression = Object.freeze({ kind: "path", path: optionalName });
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const presentValue: MojoExpression = Object.freeze({
    kind: "method-call",
    receiver: optionalPath,
    name: "value",
    arguments: Object.freeze([]),
  });
  return withMojoValue([
    ...left.before,
    Object.freeze({ kind: "variable", name: optionalName, type: leftType, initializer: left.value }),
    Object.freeze({ kind: "variable", name: resultName, type: resultType }),
    Object.freeze({
      kind: "if",
      condition: optionalPath,
      thenStatements: Object.freeze([
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: presentValue }),
      ]),
      elseStatements: Object.freeze([
        ...right.before,
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: right.value }),
      ]),
    }),
  ], resultPath);
}

function planPrefixUnary(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const operandNode = PrefixUnaryExpression_Operand(context.program.source.ast, node);
  const operator = prefixOperator(context.program.source.ast.operatorKindName(node));
  const operand = operandNode === undefined ? undefined : planMojoValue(operandNode, context);
  return operator === undefined || operand === undefined
    ? undefined
    : withMojoValue(operand.before, { kind: "unary", operator, operand: operand.value });
}

function planConditional(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const { ast } = context.program.source;
  const conditionNode = ConditionalExpression_Condition(ast, node);
  const trueNode = ConditionalExpression_WhenTrue(ast, node);
  const falseNode = ConditionalExpression_WhenFalse(ast, node);
  const resultType = context.program.queries.expressionType(node);
  const condition = conditionNode === undefined
    ? undefined
    : planMojoValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
  const whenTrue = trueNode === undefined ? undefined : planMojoValue(trueNode, context, resultType);
  const whenFalse = falseNode === undefined ? undefined : planMojoValue(falseNode, context, resultType);
  if (condition === undefined || whenTrue === undefined || whenFalse === undefined) return undefined;
  if (whenTrue.before.length === 0 && whenFalse.before.length === 0) {
    return withMojoValue(condition.before, {
      kind: "conditional",
      condition: condition.value,
      whenTrue: whenTrue.value,
      whenFalse: whenFalse.value,
    });
  }
  if (resultType === undefined) return undefined;
  registerMojoTypeImports(resultType, context);
  const resultName = allocateMojoSyntheticName(context, "conditional_value");
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  return withMojoValue([
    ...condition.before,
    Object.freeze({ kind: "variable", name: resultName, type: resultType }),
    Object.freeze({
      kind: "if",
      condition: condition.value,
      thenStatements: Object.freeze([
        ...whenTrue.before,
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: whenTrue.value }),
      ]),
      elseStatements: Object.freeze([
        ...whenFalse.before,
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: whenFalse.value }),
      ]),
    }),
  ], resultPath);
}

function planAwait(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const inner = Node_Expression(context.program.source.ast, node);
  const plan = inner === undefined ? undefined : planMojoValue(inner, context);
  const type = inner === undefined ? undefined : context.program.queries.expressionType(inner);
  if (plan === undefined || type?.kind !== "future") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_AWAIT_OPERAND_NOT_CLOSED",
      "Await requires one exact finalized Mojo future carrier.",
      node,
    );
    return undefined;
  }
  if (type.domain === "js") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_JS_PROMISE_AWAIT_RUNTIME_MISSING",
      "JavaScript Promise awaiting requires the closed Mojo JS scheduler contract.",
      node,
    );
    return undefined;
  }
  registerMojoSymbolImport(context, ["tsonic_runtime"], "create_task");
  return withMojoValue(plan.before, {
    kind: "await",
    expression: Object.freeze({
      kind: "call",
      callee: Object.freeze({ kind: "path", path: "create_task" }),
      arguments: Object.freeze([Object.freeze({
        value: plan.value,
      })]),
    }),
  });
}

function planErasedExpression(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const inner = Node_Expression(context.program.source.ast, node);
  return inner === undefined
    ? undefined
    : planMojoValue(inner, context, actualExpressionType(node, context));
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

function binaryOperandTypes(
  operator: string,
  left: Node | undefined,
  right: Node | undefined,
  result: MojoTargetTypeRef | undefined,
  context: MojoPlanningContext,
): readonly [MojoTargetTypeRef | undefined, MojoTargetTypeRef | undefined] {
  if (operator === "KindAmpersandAmpersandToken" || operator === "KindBarBarToken") {
    const bool: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: "bool" });
    return Object.freeze([bool, bool]);
  }
  if (!isComparisonOperator(operator)) return Object.freeze([result, result]);
  const leftType = left === undefined ? undefined : context.program.queries.expressionType(left);
  const rightType = right === undefined ? undefined : context.program.queries.expressionType(right);
  if (left !== undefined && (context.program.source.ast.is.IsNumericLiteral(left) ||
    context.program.source.ast.is.IsBigIntLiteral(left))) {
    return Object.freeze([rightType, undefined]);
  }
  return Object.freeze([undefined, leftType]);
}

function isComparisonOperator(operator: string): boolean {
  return operator === "KindEqualsEqualsEqualsToken" ||
    operator === "KindExclamationEqualsEqualsToken" ||
    operator === "KindLessThanToken" || operator === "KindLessThanEqualsToken" ||
    operator === "KindGreaterThanToken" || operator === "KindGreaterThanEqualsToken";
}

function isJsArray(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray";
}

function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isJsArray(type) || type.kind !== "target-named") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}
