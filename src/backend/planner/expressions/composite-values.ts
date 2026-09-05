import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  ObjectLiteralProperty_SourceName,
  ObjectLiteralProperty_Value,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoArrayLiteralFixedSpreadSelection,
  MojoArrayLiteralSelection,
} from "../../../analysis/program/model.js";
import type {
  MojoDictionaryEntry,
  MojoExpression,
  MojoStatement,
} from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import {
  planMojoProjectObjectLiteral,
  planMojoProviderRecordLiteral,
  planMojoStructuralObjectLiteral,
} from "../objects/object-literals.js";
import {
  binaryOperandTypes,
  planDictionaryKey,
  planMojoTypeTest,
  planNullishCoalescing,
} from "./conditional-values.js";
import {
  convertMojoValue,
  orderMojoValues,
} from "./support.js";
import { isJsArray, jsArrayElement } from "./js-carriers.js";
import type { OrderedMojoValue } from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export type MojoCompositeValuePlanner = (
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
) => MojoValuePlan | undefined;

const binaryOperatorText = new Map<string, string>([
  ["KindPlusToken", "+"], ["KindMinusToken", "-"], ["KindAsteriskToken", "*"],
  ["KindSlashToken", "/"], ["KindPercentToken", "%"], ["KindEqualsEqualsToken", "=="],
  ["KindEqualsEqualsEqualsToken", "=="], ["KindExclamationEqualsToken", "!="],
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
  const selection = context.program.queries.arrayLiteralSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ARRAY_LITERAL_PLAN_NOT_SEALED",
      "An array literal reached planning without its exact sealed aggregate plan.",
      node,
    );
    return undefined;
  }
  return selection.contributions.some((contribution) => contribution.kind === "sequence-spread")
    ? planDynamicArrayLiteral(selection, context, planNested)
    : planFixedArrayLiteral(selection, context, planNested);
}

function planFixedArrayLiteral(
  selection: MojoArrayLiteralSelection,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): MojoValuePlan | undefined {
  const values: OrderedMojoValue[] = [];
  let pendingBefore: MojoStatement[] = [];
  for (const contribution of selection.contributions) {
    if (contribution.kind === "sequence-spread") return undefined;
    if (contribution.kind === "value") {
      const plan = planNested(contribution.expression, context, contribution.targetType);
      if (plan === undefined) return undefined;
      values.push(Object.freeze({
        plan: withMojoValue([...pendingBefore, ...plan.before], plan.value),
        type: contribution.targetType,
        role: "array_element",
      }));
      pendingBefore = [];
      continue;
    }
    const spread = planFixedSpread(contribution, context, planNested);
    if (spread === undefined) return undefined;
    if (spread.values.length === 0) {
      pendingBefore.push(...spread.before);
      continue;
    }
    for (const [index, value] of spread.values.entries()) {
      values.push(Object.freeze({
        plan: index === 0
          ? withMojoValue([...pendingBefore, ...spread.before, ...value.before], value.value)
          : value,
        type: contribution.values[index]!.targetType,
        role: "array_spread_element",
      }));
    }
    pendingBefore = [];
  }
  const ordered = orderMojoValues(
    values,
    context,
    pendingBefore.length !== 0,
  );
  const before = Object.freeze([...ordered.before, ...pendingBefore]);
  const elements = ordered.values;
  const type = selection.resultType;
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

function planDynamicArrayLiteral(
  selection: MojoArrayLiteralSelection,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): MojoValuePlan | undefined {
  const resultElement = selection.resultType.kind === "list"
    ? selection.resultType.element
    : jsArrayElement(selection.resultType);
  if (resultElement === undefined) return undefined;
  const listType: MojoTargetTypeRef = Object.freeze({ kind: "list", element: resultElement });
  registerMojoTypeImports(listType, context);
  const resultName = allocateMojoSyntheticName(context, "array_result");
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const before: MojoStatement[] = [Object.freeze({
    kind: "variable",
    name: resultName,
    type: listType,
    initializer: Object.freeze({ kind: "list", elements: Object.freeze([]) }),
  })];
  for (const contribution of selection.contributions) {
    if (contribution.kind === "value") {
      const value = planNested(contribution.expression, context, contribution.targetType);
      if (value === undefined) return undefined;
      before.push(...value.before, appendArrayValue(
        resultPath,
        value.value,
        contribution.targetType,
        context,
      ));
      continue;
    }
    if (contribution.kind === "fixed-spread") {
      const spread = planFixedSpread(contribution, context, planNested);
      if (spread === undefined) return undefined;
      before.push(...spread.before);
      for (const [index, value] of spread.values.entries()) {
        before.push(
          ...value.before,
          appendArrayValue(resultPath, value.value, contribution.values[index]!.targetType, context),
        );
      }
      continue;
    }
    const source = planNested(contribution.expression, context, contribution.sourceType);
    if (source === undefined) return undefined;
    before.push(...source.before);
    const itemName = allocateMojoSyntheticName(context, "array_spread_item");
    const itemPath: MojoExpression = Object.freeze({ kind: "path", path: itemName });
    const selectedValue = contribution.copy
      ? Object.freeze({ kind: "copy" as const, expression: itemPath })
      : itemPath;
    const converted = convertMojoValue(mojoValue(selectedValue), contribution.conversion, context);
    if (converted === undefined) return undefined;
    const iterable: MojoExpression = contribution.iteration === "native"
      ? source.value
      : Object.freeze({
          kind: "method-call",
          receiver: source.value,
          name: "iter_values",
          arguments: Object.freeze([]),
        });
    before.push(Object.freeze({
      kind: "for",
      binding: itemName,
      iterable,
      statements: Object.freeze([
        ...converted.before,
        appendArrayValue(resultPath, converted.value, contribution.targetType, context),
      ]),
    }));
  }
  if (!isJsArray(selection.resultType)) return withMojoValue(before, resultPath);
  registerMojoTypeImports(selection.resultType, context);
  return withMojoValue(before, Object.freeze({
    kind: "construct",
    type: selection.resultType,
    arguments: Object.freeze([Object.freeze({
      value: consumeMojoValue(resultPath, listType, context.program.lifecycle),
    })]),
  }));
}

function planFixedSpread(
  selection: MojoArrayLiteralFixedSpreadSelection,
  context: MojoPlanningContext,
  planNested: MojoCompositeValuePlanner,
): { readonly before: readonly MojoStatement[]; readonly values: readonly MojoValuePlan[] } | undefined {
  const source = planNested(selection.expression, context, selection.sourceType);
  if (source === undefined) return undefined;
  registerMojoTypeImports(selection.sourceType, context);
  const sourceName = allocateMojoSyntheticName(context, "array_spread");
  const sourcePath: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const before: MojoStatement[] = [
    ...source.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      ...(selection.sourceOwnership === "fresh" ? { type: selection.sourceType } : { reference: true }),
      initializer: source.value,
    }),
  ];
  const values: MojoValuePlan[] = [];
  for (const value of selection.values) {
    const projected: MojoExpression = Object.freeze({
      kind: "element",
      receiver: sourcePath,
      index: Object.freeze({ kind: "number-literal", text: String(value.index) }),
    });
    const copied = value.copy
      ? Object.freeze({ kind: "copy" as const, expression: projected })
      : projected;
    const converted = convertMojoValue(mojoValue(copied), value.conversion, context);
    if (converted === undefined) return undefined;
    values.push(converted);
  }
  return Object.freeze({ before: Object.freeze(before), values: Object.freeze(values) });
}

function appendArrayValue(
  result: MojoExpression,
  value: MojoExpression,
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoStatement {
  return Object.freeze({
    kind: "expression",
    expression: Object.freeze({
      kind: "method-call",
      receiver: result,
      name: "append",
      arguments: Object.freeze([Object.freeze({
        value: consumeMojoValue(value, type, context.program.lifecycle),
      })]),
    }),
  });
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
  const structural = planMojoStructuralObjectLiteral(node, context, planNested);
  if (structural !== undefined) return structural;
  const type = context.program.queries.expressionType(node);
  if (type?.kind !== "dictionary") {
    appendMojoPlanningDiagnostic(context, "MOJO_SEALED_OBJECT_LITERAL_PLAN_MISSING", "Object literal reached planning without its sealed dictionary, structural, provider-record, or project-object representation.", node);
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
    const callableIdentity = planErasedCallableIdentityComparison(
      operatorKind,
      leftNode,
      rightNode,
      ordered.values[0]!,
      ordered.values[1]!,
      context,
    );
    return withMojoValue(
      ordered.before,
      callableIdentity ?? Object.freeze({
        kind: "binary" as const,
        operator,
        left: ordered.values[0]!,
        right: ordered.values[1]!,
        ...((leftType.kind === "source-primitive" || leftType.kind === "native-string") &&
          (rightType.kind === "source-primitive" || rightType.kind === "native-string")
          ? { evaluation: "read-only" as const }
          : {}),
      }),
    );
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

function planErasedCallableIdentityComparison(
  operatorKind: string,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  left: MojoExpression,
  right: MojoExpression,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if ((operatorKind !== "KindEqualsEqualsToken" &&
      operatorKind !== "KindEqualsEqualsEqualsToken" &&
      operatorKind !== "KindExclamationEqualsToken" &&
      operatorKind !== "KindExclamationEqualsEqualsToken") ||
    leftNode === undefined || rightNode === undefined ||
    context.program.representations.callable(leftNode)?.kind !== "erased" ||
    context.program.representations.callable(rightNode)?.kind !== "erased") return undefined;
  const identity = (receiver: MojoExpression): MojoExpression => Object.freeze({
    kind: "method-call",
    receiver,
    name: "identity",
    arguments: Object.freeze([]),
  });
  return Object.freeze({
    kind: "binary",
    operator: operatorKind === "KindEqualsEqualsToken" ||
        operatorKind === "KindEqualsEqualsEqualsToken"
      ? "is"
      : "is not",
    left: identity(left),
    right: identity(right),
  });
}
