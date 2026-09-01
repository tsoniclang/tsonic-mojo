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
import type { MojoValueConversion } from "../../analysis/program/model.js";
import type {
  MojoCallArgument,
  MojoDictionaryEntry,
  MojoExpression,
  MojoStatement,
} from "../target-ast/nodes.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoQualifiedModuleMember,
  registerMojoModuleImport,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import { mojoTypeName, registerMojoTypeImports } from "./types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { mojoModuleBindingRead, mojoModuleBindingWrite } from "./module-bindings.js";

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
  readonly before: readonly MojoStatement[];
  readonly operator: string;
  readonly left: MojoExpression;
  readonly right: MojoExpression;
}

interface OrderedMojoValue {
  readonly plan: MojoValuePlan;
  readonly type: MojoTargetTypeRef;
  readonly role: string;
}

interface PlannedMojoCallArgument {
  readonly plan: MojoValuePlan;
  readonly type: MojoTargetTypeRef;
  readonly name?: string;
  readonly spread: boolean;
}

type PreparedMojoReceiver =
  | { readonly kind: "required"; readonly plan: MojoValuePlan }
  | {
      readonly kind: "optional";
      readonly before: readonly MojoStatement[];
      readonly condition: MojoExpression;
      readonly plan: MojoValuePlan;
    };

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
    ? planProperty(operand, context, "write", false)
    : ast.is.IsElementAccessExpression(operand)
      ? planElement(operand, context, "write", false)
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
    ? planProperty(leftNode, context, "write", stabilizeLocation)
    : ast.is.IsElementAccessExpression(leftNode)
      ? planElement(leftNode, context, "write", stabilizeLocation)
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
    plan = planCall(node, context);
  } else if (ast.is.IsPropertyAccessExpression(node)) {
    plan = planProperty(node, context, "read");
  } else if (ast.is.IsElementAccessExpression(node)) {
    plan = planElement(node, context, "read");
  } else {
    const expression = planMojoExpressionOnly(node, context);
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

function planMojoExpressionOnly(
  node: Node,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const { ast } = context.program.source;
  let planned: MojoExpression | undefined;
  if (ast.is.IsIdentifier(node) || ast.kindName(node) === "KindThisKeyword") {
    const selectedValue = context.program.queries.valueSelection(node);
    if (selectedValue !== undefined) {
      planned = planProviderConstant(
        selectedValue.operation,
        selectedValue.resultConversion,
        context,
      );
      if (planned === undefined) return undefined;
    } else {
      const moduleBinding = context.program.queries.moduleBinding(node);
      if (moduleBinding !== undefined) {
        planned = mojoModuleBindingRead(moduleBinding, context);
        if (planned === undefined) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_MODULE_BINDING_PLAN_MISSING",
            `Module binding '${moduleBinding.sourceName}' has no sealed Mojo storage path.`,
            node,
          );
          return undefined;
        }
      } else {
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
        const ownerModule = context.program.modules.forSourceFile(
          context.program.queries.bindingSourceFile(node),
        );
        planned = {
          kind: "path",
          path: ownerModule === undefined
            ? name
            : mojoQualifiedModuleMember(context, ownerModule.modulePath, name),
        };
      }
    }
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
  return planned;
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
  return plan === undefined
    ? undefined
    : withMojoValue(plan.before, { kind: "await", expression: plan.value });
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
  if (left !== undefined && context.program.source.ast.is.IsNumericLiteral(left)) {
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

function planElement(
  node: Node,
  context: MojoPlanningContext,
  mode: "read" | "write",
  stabilizeComponents = false,
): MojoValuePlan | undefined {
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
  const sourceReceiverType = selection.kind === "native"
    ? selection.receiverType
    : selection.sourceReceiverType;
  const preparedReceiver = prepareMojoReceiver(
    selection.receiver,
    sourceReceiverType,
    selection.optionalChain,
    context,
  );
  const receiver = preparedReceiver === undefined
    ? undefined
    : selection.kind === "provider"
      ? convertMojoValue(preparedReceiver.plan, selection.receiverConversion, context)
      : preparedReceiver.plan;
  const rawIndex = planMojoValue(selection.index, context);
  const index = rawIndex === undefined
    ? undefined
    : convertMojoValue(rawIndex, selection.indexConversion, context);
  if (preparedReceiver === undefined || receiver === undefined || index === undefined) return undefined;
  const operation = selection.kind === "provider"
    ? mode === "read" ? selection.readOperation : selection.writeOperation
    : undefined;
  if (selection.kind === "provider") {
    const expectedKind = mode === "read" ? "index-read" : "index-write";
    if (operation?.target.kind !== expectedKind) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_ELEMENT_FORM_INVALID",
        `Provider element ${mode} has no sealed '${expectedKind}' form.`,
        node,
      );
      return undefined;
    }
  }
  const receiverType = selection.kind === "native" ? selection.receiverType : operation?.receiverType;
  const indexType = selection.kind === "native" ? selection.indexType : operation?.parameterTypes[0];
  if (receiverType === undefined || indexType === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver, type: receiverType, role: "element_receiver" }),
    Object.freeze({ plan: index, type: indexType, role: "element_index" }),
  ], context, stabilizeComponents);
  const access: MojoExpression = {
    kind: "element",
    receiver: ordered.values[0]!,
    index: ordered.values[1]!,
  };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(ordered.before, access)
    : convertMojoValue(
        withMojoValue(ordered.before, access),
        selection.readResultConversion,
        context,
      );
  return operationPlan === undefined
    ? undefined
    : finishOptionalMojoOperation(node, preparedReceiver, operationPlan, context);
}

function planCall(node: Node, context: MojoPlanningContext): MojoValuePlan | undefined {
  const selection = context.program.queries.callSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(context, "MOJO_CALL_PLAN_MISSING", "Call expression has no sealed target selection.", node);
    return undefined;
  }
  if (selection.kind === "project") {
    const arguments_ = selection.arguments.map((argument) => planSelectedArgument(argument, context));
    if (arguments_.some((argument) => argument === undefined)) return undefined;
    const plannedArguments = arguments_ as PlannedMojoCallArgument[];
    let call: MojoExpression;
    let before: readonly MojoStatement[];
    switch (selection.target.kind) {
      case "function": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "call",
          callee: {
            kind: "path",
            path: mojoQualifiedModuleMember(
              context,
              selection.target.modulePath,
              selection.target.name,
            ),
          },
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: ordered.arguments,
        };
        break;
      }
      case "method": {
        const receiver = prepareMojoReceiver(
          selection.target.receiver,
          selection.target.receiverType,
          selection.optionalChain,
          context,
        );
        if (receiver === undefined) return undefined;
        const ordered = orderCallArguments(plannedArguments, context, Object.freeze({
          plan: receiver.plan,
          type: selection.target.receiverType,
          role: "call_receiver",
        }));
        before = ordered.before;
        call = {
          kind: "method-call",
          receiver: ordered.receiver!,
          name: selection.target.name,
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: ordered.arguments,
        };
        const converted = applyMojoConversion(call, selection.resultConversion, context);
        if (converted === undefined) return undefined;
        return finishOptionalMojoOperation(
          node,
          receiver,
          withMojoValue(before, converted),
          context,
        );
      }
      case "static-method": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        registerMojoTypeImports(selection.target.owner, context);
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "method-call",
          receiver: { kind: "path", path: requiredMojoTypeName(selection.target.owner, context) },
          name: selection.target.name,
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: ordered.arguments,
        };
        break;
      }
      case "constructor": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        registerMojoTypeImports(selection.target.type, context);
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "construct",
          type: selection.target.type,
          arguments: ordered.arguments,
        };
        break;
      }
    }
    const converted = applyMojoConversion(call, selection.resultConversion, context);
    return converted === undefined ? undefined : withMojoValue(before, converted);
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
  const plannedArguments = arguments_ as PlannedMojoCallArgument[];
  let call: MojoExpression;
  let before: readonly MojoStatement[];
  if (target.kind === "function-call") {
    if (selection.optionalChain) return unsupportedOptionalCall(node, context);
    registerMojoModuleImport(context, target.modulePath);
    const ordered = orderCallArguments(plannedArguments, context);
    before = ordered.before;
    call = {
      kind: "call",
      callee: { kind: "path", path: [...target.modulePath, ...(target.ownerPath ?? []), target.name].join(".") },
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: ordered.arguments,
    };
  } else if (target.kind === "instance-call") {
    if (selection.receiver === undefined) return undefined;
    if (selection.sourceReceiverType === undefined) return undefined;
    const preparedReceiver = prepareMojoReceiver(
      selection.receiver,
      selection.sourceReceiverType,
      selection.optionalChain,
      context,
    );
    const receiver = preparedReceiver === undefined || selection.receiverConversion === undefined
      ? preparedReceiver?.plan
      : convertMojoValue(preparedReceiver.plan, selection.receiverConversion, context);
    if (preparedReceiver === undefined || receiver === undefined || selection.operation.receiverType === undefined) {
      return undefined;
    }
    const ordered = orderCallArguments(plannedArguments, context, Object.freeze({
      plan: receiver,
      type: selection.operation.receiverType,
      role: "call_receiver",
    }));
    before = ordered.before;
    call = {
      kind: "method-call",
      receiver: target.receiver === "var" || target.receiver === "deinit"
        ? { kind: "consume", expression: ordered.receiver! }
        : ordered.receiver!,
      name: target.name,
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: ordered.arguments,
    };
    const converted = applyMojoConversion(call, selection.resultConversion, context);
    if (converted === undefined) return undefined;
    return finishOptionalMojoOperation(
      node,
      preparedReceiver,
      withMojoValue(before, converted),
      context,
    );
  } else {
    return undefined;
  }
  const converted = applyMojoConversion(call, selection.resultConversion, context);
  return converted === undefined ? undefined : withMojoValue(before, converted);
}

function planProperty(
  node: Node,
  context: MojoPlanningContext,
  mode: "read" | "write",
  stabilizeReceiver = false,
): MojoValuePlan | undefined {
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
  if (selection.kind === "provider-constant") {
    if (mode !== "read") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_CONSTANT_WRITE_UNSUPPORTED",
        "A provider module constant cannot be planned as a writable location.",
        node,
      );
      return undefined;
    }
    const constant = planProviderConstant(
      selection.operation,
      selection.readResultConversion,
      context,
    );
    return constant === undefined ? undefined : mojoValue(constant);
  }
  if (selection.kind === "project-enum-member") {
    if (mode !== "read") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_ENUM_MEMBER_WRITE_UNSUPPORTED",
        "A project enum member is an immutable compile-time value.",
        node,
      );
      return undefined;
    }
    registerMojoTypeImports(selection.owner, context);
    const owner = mojoTypeName(selection.owner, context.module.modulePath);
    return owner === undefined
      ? undefined
      : mojoValue(Object.freeze({ kind: "path", path: `${owner}.${selection.name}` }));
  }
  if (selection.kind === "project-static-field") {
    if (selection.optionalChain) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_STATIC_FIELD_OPTIONAL_CHAIN_UNSUPPORTED",
        "A project static field optional chain requires an exact nullable class-value carrier.",
        node,
      );
      return undefined;
    }
    const field = mode === "read"
      ? mojoModuleBindingRead(selection.binding, context)
      : mojoModuleBindingWrite(selection.binding, context);
    return field === undefined ? undefined : mojoValue(field);
  }
  const sourceReceiverType = selection.kind === "project-field"
    ? selection.receiverType
    : selection.sourceReceiverType;
  const receiver = prepareMojoReceiver(
    selection.receiver,
    sourceReceiverType,
    selection.optionalChain,
    context,
  );
  if (receiver === undefined) return undefined;
  if (selection.kind === "project-field") {
    const ordered = orderMojoValues([
      Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "property_receiver" }),
    ], context, stabilizeReceiver);
    const operation = withMojoValue(ordered.before, {
      kind: "member",
      receiver: {
        kind: "postfix-deref",
        expression: { kind: "member", receiver: ordered.values[0]!, name: "_state" },
      },
      name: selection.fieldName,
    });
    return finishOptionalMojoOperation(node, receiver, operation, context);
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
    ? receiver.plan
    : convertMojoValue(receiver.plan, selection.receiverConversion, context);
  if (convertedReceiver === undefined || operation.receiverType === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({
      plan: convertedReceiver,
      type: operation.receiverType,
      role: "property_receiver",
    }),
  ], context, stabilizeReceiver);
  if (target.kind !== "property-read" && target.kind !== "property-write") return undefined;
  const member: MojoExpression = { kind: "member", receiver: ordered.values[0]!, name: target.name };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(ordered.before, member)
    : convertMojoValue(
        withMojoValue(ordered.before, member),
        selection.readResultConversion,
        context,
      );
  return operationPlan === undefined
    ? undefined
    : finishOptionalMojoOperation(node, receiver, operationPlan, context);
}

function planProviderConstant(
  operation: import("../../analysis/program/model.js").MojoSelectedProviderOperation,
  resultConversion: MojoValueConversion,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (operation.target.kind !== "constant") return undefined;
  registerMojoModuleImport(context, operation.target.modulePath);
  return applyMojoConversion(
    {
      kind: "path",
      path: [...operation.target.modulePath, operation.target.name].join("."),
    },
    resultConversion,
    context,
  );
}

function planSelectedArgument(
  argument: import("../../analysis/program/model.js").MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
): PlannedMojoCallArgument | undefined {
  const expression = planMojoValue(argument.expression, context);
  if (expression === undefined) return undefined;
  const converted = applyMojoConversion(
    expression.value,
    argument.conversion,
    context,
  );
  if (converted === undefined) return undefined;
  const value: MojoExpression = argument.passing === "consume"
    ? { kind: "consume", expression: converted }
    : converted;
  return Object.freeze({
    plan: withMojoValue(expression.before, value),
    type: argument.parameterType,
    ...(argument.position === "keyword" ? { name: argument.nativeName! } : {}),
    spread: argument.spread,
  });
}

function orderCallArguments(
  arguments_: readonly PlannedMojoCallArgument[],
  context: MojoPlanningContext,
  receiver?: OrderedMojoValue,
): {
  readonly before: readonly MojoStatement[];
  readonly receiver?: MojoExpression;
  readonly arguments: readonly MojoCallArgument[];
} {
  const ordered = orderMojoValues([
    ...(receiver === undefined ? [] : [receiver]),
    ...arguments_.map((argument) => Object.freeze({
      plan: argument.plan,
      type: argument.type,
      role: "call_argument",
    })),
  ], context);
  const offset = receiver === undefined ? 0 : 1;
  return Object.freeze({
    before: ordered.before,
    ...(receiver === undefined ? {} : { receiver: ordered.values[0]! }),
    arguments: Object.freeze(arguments_.map((argument, index) => Object.freeze({
      value: ordered.values[index + offset]!,
      ...(argument.name === undefined ? {} : { name: argument.name }),
      ...(argument.spread ? { spread: true } : {}),
    }))),
  });
}

function orderMojoValues(
  values: readonly OrderedMojoValue[],
  context: MojoPlanningContext,
  stabilizeAll = false,
): { readonly before: readonly MojoStatement[]; readonly values: readonly MojoExpression[] } {
  let finalPreludeIndex = -1;
  for (const [index, value] of values.entries()) {
    if (value.plan.before.length !== 0) finalPreludeIndex = index;
  }
  const before: MojoStatement[] = [];
  const expressions: MojoExpression[] = [];
  for (const [index, value] of values.entries()) {
    before.push(...value.plan.before);
    if (stabilizeAll || index < finalPreludeIndex) {
      registerMojoTypeImports(value.type, context);
      const name = allocateMojoSyntheticName(context, value.role);
      before.push(Object.freeze({
        kind: "variable",
        name,
        type: value.type,
        initializer: value.plan.value,
      }));
      expressions.push(Object.freeze({ kind: "path", path: name }));
    } else {
      expressions.push(value.plan.value);
    }
  }
  return Object.freeze({
    before: Object.freeze(before),
    values: Object.freeze(expressions),
  });
}

function convertMojoValue(
  plan: MojoValuePlan,
  conversion: MojoValueConversion,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  const converted = applyMojoConversion(plan.value, conversion, context);
  return converted === undefined ? undefined : withMojoValue(plan.before, converted);
}

function prepareMojoReceiver(
  expression: Node,
  selectedType: MojoTargetTypeRef,
  optionalChain: boolean,
  context: MojoPlanningContext,
): PreparedMojoReceiver | undefined {
  const receiver = planMojoValue(expression, context);
  if (receiver === undefined) return undefined;
  if (!optionalChain) return Object.freeze({ kind: "required", plan: receiver });
  const actualType = context.program.queries.expressionType(expression);
  if (actualType?.kind !== "optional" || !mojoTargetTypeEquals(actualType.value, selectedType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OPTIONAL_RECEIVER_CARRIER_UNPROVEN",
      "Optional chaining requires one exact Optional[T] receiver whose T matches the checker-selected non-null receiver.",
      expression,
    );
    return undefined;
  }
  registerMojoTypeImports(actualType, context);
  const receiverName = allocateMojoSyntheticName(context, "optional_receiver");
  const receiverPath: MojoExpression = Object.freeze({ kind: "path", path: receiverName });
  return Object.freeze({
    kind: "optional",
    before: Object.freeze([
      ...receiver.before,
      Object.freeze({
        kind: "variable",
        name: receiverName,
        type: actualType,
        initializer: receiver.value,
      }),
    ]),
    condition: receiverPath,
    plan: mojoValue(Object.freeze({
      kind: "method-call",
      receiver: receiverPath,
      name: "value",
      arguments: Object.freeze([]),
    })),
  });
}

function finishOptionalMojoOperation(
  expression: Node,
  receiver: PreparedMojoReceiver,
  operation: MojoValuePlan,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (receiver.kind === "required") return operation;
  const resultType = context.program.queries.expressionType(expression);
  if (resultType?.kind !== "optional") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OPTIONAL_RESULT_CARRIER_UNPROVEN",
      "Optional chaining requires one exact Optional[T] result carrier.",
      expression,
    );
    return undefined;
  }
  registerMojoTypeImports(resultType, context);
  const resultName = allocateMojoSyntheticName(context, "optional_result");
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  return withMojoValue([
    ...receiver.before,
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: resultType,
      initializer: Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([]),
      }),
    }),
    Object.freeze({
      kind: "if",
      condition: receiver.condition,
      thenStatements: Object.freeze([
        ...operation.before,
        Object.freeze({
          kind: "assignment",
          operator: "=",
          left: resultPath,
          right: operation.value,
        }),
      ]),
    }),
  ], resultPath);
}

function unsupportedOptionalCall(
  node: Node,
  context: MojoPlanningContext,
): undefined {
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_OPTIONAL_CALLABLE_VALUE_UNSUPPORTED",
    "An optional call without an exact receiver requires a sealed callable-value representation.",
    node,
  );
  return undefined;
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
    case "optional-none":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([]) };
    case "optional-some":
    case "union-inject":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
  }
}

function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

function requiredMojoTypeName(type: MojoTargetTypeRef, context: MojoPlanningContext): string {
  const name = mojoTypeName(type, context.module.modulePath);
  if (name === undefined) throw new Error("A Mojo unit type cannot own a static method.");
  return name;
}
