import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  ObjectLiteralProperty_SourceName,
  ObjectLiteralProperty_Value,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoDictionaryEntry, MojoExpression } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/render.js";
import {
  planMojoProjectObjectLiteral,
  planMojoProviderRecordLiteral,
} from "../objects/object-literals.js";
import {
  binaryOperandTypes,
  planDictionaryKey,
  planMojoTypeTest,
  planNullishCoalescing,
} from "./conditional-values.js";
import {
  isJsArray,
  jsArrayElement,
  orderMojoValues,
} from "./support.js";
import type { OrderedMojoValue } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export type MojoCompositeValuePlanner = (
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
) => MojoValuePlan | undefined;

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

export function planArrayLiteral(
  node: Node,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): MojoValuePlan | undefined {
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
    planNested(element, context, expected[index]));
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

export function planObjectLiteral(
  node: Node,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): MojoValuePlan | undefined {
  const provider = planMojoProviderRecordLiteral(node, context, planNested);
  if (provider !== undefined) return provider;
  const project = planMojoProjectObjectLiteral(node, context, planNested);
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
    const value = planNested(valueNode, context, type.value);
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

export function planParenthesized(
  node: Node,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): MojoValuePlan | undefined {
  const inner = Node_Expression(context.program.source.ast, node);
  const plan = inner === undefined ? undefined : planNested(inner, context);
  return plan === undefined
    ? undefined
    : withMojoValue(plan.before, { kind: "parenthesized", expression: plan.value });
}

export function planBinary(
  node: Node,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): MojoValuePlan | undefined {
  const { ast } = context.program.source;
  const typeTest = context.program.queries.typeTestSelection(node);
  if (typeTest !== undefined) return planMojoTypeTest(typeTest, context, planNested);
  if (ast.operatorKindName(node) === "KindInstanceOfKeyword") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_TYPE_TEST_SELECTION_NOT_SEALED",
      "A checked instanceof expression requires one exact sealed Mojo type-test selection.",
      node,
    );
    return undefined;
  }
  const leftNode = BinaryExpression_Left(ast, node);
  const rightNode = BinaryExpression_Right(ast, node);
  const operatorKind = ast.kindName(ast.as.AsBinaryExpression(node)?.OperatorToken);
  if (operatorKind === "KindQuestionQuestionToken") {
    return planNullishCoalescing(node, leftNode, rightNode, context, planNested);
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
  const left = leftNode === undefined ? undefined : planNested(leftNode, context, leftExpected);
  const right = rightNode === undefined ? undefined : planNested(rightNode, context, rightExpected);
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
