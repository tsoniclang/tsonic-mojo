import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  ObjectLiteralProperty_SourceName,
  ObjectLiteralProperty_Value,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type {
  MojoDictionaryEntry,
  MojoExpression,
  MojoStatement,
} from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoBindingPlanOverride,
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  planMojoCall,
} from "./calls.js";
import { planMojoElement } from "./elements.js";
import { planMojoProperty, planMojoProviderPropertyMethodWrite } from "./properties.js";
import { planMojoLeafExpression } from "./leaves.js";
import {
  convertMojoValue,
  isJsArray,
  jsArrayElement,
  orderMojoValues,
  requiredConversion,
} from "./support.js";
import type { OrderedMojoValue } from "./support.js";
import { registerMojoTypeImports } from "../types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import {
  planMojoProjectObjectLiteral,
  planMojoProviderRecordLiteral,
} from "../objects/object-literals.js";
import { planMojoCallableExpression } from "./callables.js";
import {
  binaryOperandTypes,
  planAwait,
  planConditional,
  planDictionaryKey,
  planErasedExpression,
  planMojoTypeTest,
  planNullishCoalescing,
  planPrefixUnary,
} from "./conditional-values.js";
import { planMojoTemplateExpression } from "./template-strings.js";
import { adaptMojoValueErrorDomain } from "./error-domains.js";

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
  readonly statement: MojoStatement;
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
  const storage = plannedLocationExpression(operand, context);
  if (storage !== undefined) {
    return Object.freeze({
      before: Object.freeze([]),
      statement: Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "method-call",
          receiver: storage,
          name: "write",
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({
              kind: "binary",
              operator: operator.slice(0, -1),
              left: Object.freeze({
                kind: "method-call",
                receiver: storage,
                name: "read",
                arguments: Object.freeze([]),
              }),
              right: Object.freeze({ kind: "number-literal", text: "1" }),
            }),
          })]),
        }),
      }),
    });
  }
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
    statement: Object.freeze({
      kind: "assignment",
      operator,
      left: left.value,
      right: Object.freeze({ kind: "number-literal", text: "1" }),
    }),
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
  const writeType = property?.kind === "provider" || property?.kind === "provider-static"
    ? property.writeOperation?.parameterTypes[0]
    : element?.writeType;
  const targetType = writeType ?? leftType;
  const right = planMojoValue(rightNode, context, targetType);
  if (right === undefined) return undefined;
  if (property?.kind === "provider" &&
    property.writeOperation?.target.kind === "property-write" &&
    property.writeOperation.target.access.kind === "method") {
    return planMojoProviderPropertyMethodWrite(
      leftNode,
      right,
      operator,
      context,
      planMojoValue,
    );
  }
  if (property?.kind === "provider-static") {
    const write = property.writeOperation;
    if (write?.target.kind !== "function-write" || write.parameterTypes.length !== 1 ||
      write.resultType.kind !== "unit") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_STATIC_PROPERTY_WRITE_MISSING",
        "Static provider assignment has no sealed target write function.",
        leftNode,
      );
      return undefined;
    }
    registerMojoModuleImport(context, write.target.modulePath);
    let value = right.value;
    const before: MojoStatement[] = [];
    if (operator !== "=") {
      if (leftType === undefined || targetType === undefined ||
        !mojoTargetTypeEquals(leftType, targetType)) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_PROVIDER_STATIC_COMPOUND_ASSIGNMENT_UNSUPPORTED",
          "Static provider compound assignment requires identical closed read and write carriers.",
          leftNode,
        );
        return undefined;
      }
      const current = planMojoProperty(leftNode, context, planMojoValue, "read");
      if (current === undefined) return undefined;
      const ordered = orderMojoValues([
        Object.freeze({ plan: current, type: leftType, role: "static_property_read" }),
        Object.freeze({ plan: right, type: targetType, role: "static_property_right" }),
      ], context, true);
      before.push(...ordered.before);
      value = Object.freeze({
        kind: "binary",
        operator: operator.slice(0, -1),
        left: ordered.values[0]!,
        right: ordered.values[1]!,
      });
    } else {
      before.push(...right.before);
    }
    return Object.freeze({
      before: Object.freeze(before),
      statement: Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "call",
          callee: Object.freeze({
            kind: "path",
            path: [...write.target.modulePath, write.target.name].join("."),
          }),
          arguments: Object.freeze([Object.freeze({
            value,
            ...(write.target.value.position === "keyword"
              ? { name: write.target.value.nativeName! }
              : {}),
          })]),
        }),
      }),
    });
  }
  const storage = plannedLocationExpression(leftNode, context);
  if (storage !== undefined) {
    const value: MojoExpression = operator === "="
      ? right.value
      : Object.freeze({
          kind: "binary",
          operator: operator.slice(0, -1),
          left: Object.freeze({
            kind: "method-call",
            receiver: storage,
            name: "read",
            arguments: Object.freeze([]),
          }),
          right: right.value,
        });
    return Object.freeze({
      before: right.before,
      statement: Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "method-call",
          receiver: storage,
          name: "write",
          arguments: Object.freeze([Object.freeze({ value })]),
        }),
      }),
    });
  }
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
    statement: Object.freeze({
      kind: "assignment",
      operator: plannedOperator,
      left: left.value,
      right: plannedRight,
    }),
  });
}

function plannedLocationExpression(
  node: Node,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const override = mojoBindingPlanOverride(node, context);
  if (override?.storage === "location") return override.expression;
  const storage = context.program.queries.locationStorage(node);
  return storage === undefined
    ? undefined
    : Object.freeze({ kind: "path", path: storage.name });
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
  const actualType = context.program.queries.expressionType(node);
  const conversion = expectedType === undefined || actualType === undefined
    ? undefined
    : requiredConversion(node, expectedType, context);
  if (expectedType !== undefined && actualType !== undefined && conversion === undefined) {
    return undefined;
  }
  const inlineCallableWidening = conversion?.kind === "callable-raise-widen" &&
    (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node));
  let plan: MojoValuePlan | undefined;
  if (ast.is.IsArrayLiteralExpression(node)) {
    plan = planArrayLiteral(node, context);
  } else if (ast.kindName(node) === "KindTemplateExpression") {
    plan = planMojoTemplateExpression(node, context, planMojoValue);
  } else if (ast.is.IsObjectLiteralExpression(node)) {
    plan = planObjectLiteral(node, context);
  } else if (ast.is.IsParenthesizedExpression(node)) {
    plan = planParenthesized(node, context);
  } else if (ast.is.IsBinaryExpression(node)) {
    plan = planBinary(node, context);
  } else if (ast.is.IsPrefixUnaryExpression(node)) {
    plan = planPrefixUnary(node, context, planMojoValue);
  } else if (ast.is.IsConditionalExpression(node)) {
    plan = planConditional(node, context, planMojoValue);
  } else if (ast.is.IsAwaitExpression(node)) {
    plan = planAwait(node, context, planMojoValue);
  } else if (ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) ||
    ast.is.IsNonNullExpression(node) || ast.is.IsSatisfiesExpression(node)) {
    plan = planErasedExpression(node, context, planMojoValue);
  } else if (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) {
    plan = planMojoCallableExpression(
      node,
      context,
      planMojoValue,
      inlineCallableWidening && conversion?.kind === "callable-raise-widen" &&
          conversion.targetType.kind === "callable"
        ? conversion.targetType
        : undefined,
    );
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
  const converted = expectedType === undefined || actualType === undefined || inlineCallableWidening
    ? plan
    : conversion === undefined
      ? undefined
      : convertMojoValue(plan, conversion, context);
  if (converted === undefined) return undefined;
  const resultType = expectedType ?? actualType;
  return resultType === undefined
    ? converted
    : adaptMojoValueErrorDomain(
        converted,
        resultType,
        context.program.queries.expressionErrorType(node),
        context.errorType,
        node,
        context,
      );
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
  const provider = planMojoProviderRecordLiteral(node, context, planMojoValue);
  if (provider !== undefined) return provider;
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
  const typeTest = context.program.queries.typeTestSelection(node);
  if (typeTest !== undefined) return planMojoTypeTest(typeTest, context, planMojoValue);
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
    return planNullishCoalescing(node, leftNode, rightNode, context, planMojoValue);
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
