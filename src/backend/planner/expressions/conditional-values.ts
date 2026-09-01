import type { Node } from "@tsonic/tsts";
import {
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  Node_Expression,
  PrefixUnaryExpression_Operand,
} from "@tsonic/target-api/source";
import type { MojoTypeTestSelection } from "../../../analysis/program/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  registerMojoSymbolImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/render.js";
import { applyValueRefinement } from "./leaves.js";
import { isJsString } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planNullishCoalescing(
  node: Node,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  if (leftNode === undefined || rightNode === undefined) return undefined;
  const leftType = context.program.queries.expressionType(leftNode);
  const resultType = context.program.queries.expressionType(node);
  const left = planValue(leftNode, context);
  const right = planValue(rightNode, context, resultType);
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

export function planPrefixUnary(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const operandNode = PrefixUnaryExpression_Operand(context.program.source.ast, node);
  const operator = prefixOperator(context.program.source.ast.operatorKindName(node));
  const operand = operandNode === undefined ? undefined : planValue(operandNode, context);
  return operator === undefined || operand === undefined
    ? undefined
    : withMojoValue(operand.before, { kind: "unary", operator, operand: operand.value });
}

export function planConditional(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const { ast } = context.program.source;
  const conditionNode = ConditionalExpression_Condition(ast, node);
  const trueNode = ConditionalExpression_WhenTrue(ast, node);
  const falseNode = ConditionalExpression_WhenFalse(ast, node);
  const resultType = context.program.queries.expressionType(node);
  const condition = conditionNode === undefined
    ? undefined
    : planValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
  const whenTrue = trueNode === undefined ? undefined : planValue(trueNode, context, resultType);
  const whenFalse = falseNode === undefined ? undefined : planValue(falseNode, context, resultType);
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

export function planAwait(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const inner = Node_Expression(context.program.source.ast, node);
  const plan = inner === undefined ? undefined : planValue(inner, context);
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
  const taskFactory = type.raises ? "create_raising_task" : "create_task";
  registerMojoSymbolImport(context, ["tsonic_runtime"], taskFactory);
  const task = Object.freeze({
    kind: "call" as const,
    callee: Object.freeze({ kind: "path" as const, path: taskFactory }),
    arguments: Object.freeze([Object.freeze({ value: plan.value })]),
  });
  return withMojoValue(plan.before, {
    kind: "await",
    expression: task,
  });
}

export function planErasedExpression(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const inner = Node_Expression(context.program.source.ast, node);
  if (inner === undefined) return undefined;
  const refinement = context.program.queries.valueRefinement(node);
  const plan = planValue(
    inner,
    context,
    refinement === undefined ? context.program.queries.expressionType(node) : undefined,
  );
  return plan === undefined
    ? undefined
    : withMojoValue(plan.before, applyValueRefinement(plan.value, refinement, context));
}

export function planMojoTypeTest(
  selection: MojoTypeTestSelection,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const operand = planValue(selection.operand, context);
  if (operand === undefined) return undefined;
  if (selection.kind === "constant") {
    return withMojoValue(
      Object.freeze([
        ...operand.before,
        Object.freeze({ kind: "expression" as const, expression: operand.value }),
      ]),
      Object.freeze({ kind: "bool-literal", value: selection.value }),
    );
  }
  registerMojoTypeImports(selection.sourceType, context);
  if (selection.kind === "optional-presence") {
    return withMojoValue(operand.before, Object.freeze({
      kind: "construct",
      type: Object.freeze({ kind: "source-primitive", name: "bool" }),
      arguments: Object.freeze([{ value: operand.value }]),
    }));
  }
  registerMojoTypeImports(selection.testedType, context);
  return withMojoValue(operand.before, Object.freeze({
    kind: "method-call",
    receiver: operand.value,
    name: "isa",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: selection.testedType })]),
    arguments: Object.freeze([]),
  }));
}

export function planDictionaryKey(
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

export function binaryOperandTypes(
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

function prefixOperator(kind: string | undefined): string | undefined {
  switch (kind) {
    case "KindPlusToken": return "+";
    case "KindMinusToken": return "-";
    case "KindExclamationToken": return "not";
    case "KindTildeToken": return "~";
    default: return undefined;
  }
}

function isComparisonOperator(operator: string): boolean {
  return operator === "KindEqualsEqualsEqualsToken" ||
    operator === "KindExclamationEqualsEqualsToken" ||
    operator === "KindLessThanToken" || operator === "KindLessThanEqualsToken" ||
    operator === "KindGreaterThanToken" || operator === "KindGreaterThanEqualsToken";
}
