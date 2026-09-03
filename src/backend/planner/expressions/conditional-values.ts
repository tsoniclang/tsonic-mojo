import type { Node } from "@tsonic/tsts";
import {
  ConditionalExpression_Condition,
  ConditionalExpression_WhenFalse,
  ConditionalExpression_WhenTrue,
  Node_Expression,
  PrefixUnaryExpression_Operand,
} from "@tsonic/target-api/source";
import type { MojoTypeTestSelection } from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  registerMojoSymbolImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { applyValueRefinement } from "./leaves.js";
import { convertMojoValue } from "./support.js";
import { isJsString } from "./js-carriers.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import {
  isMojoCompileTimeCondition,
  planMojoCompileTimeCondition,
} from "../compile-time/values.js";

export function planNullishCoalescing(
  node: Node,
  leftNode: Node | undefined,
  rightNode: Node | undefined,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.nullishCoalescingSelection(node);
  if (leftNode === undefined || rightNode === undefined || selection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_NULLISH_COALESCING_SELECTION_MISSING",
      "Nullish coalescing has no sealed Mojo evaluation contract.",
      node,
    );
    return undefined;
  }
  const left = planValue(selection.left, context);
  if (left === undefined) return undefined;
  if (selection.kind === "left") {
    return convertMojoValue(left, selection.conversion, context);
  }
  const right = planValue(selection.right, context);
  if (right === undefined) return undefined;
  if (selection.kind === "right") {
    const converted = convertMojoValue(right, selection.conversion, context);
    return converted === undefined
      ? undefined
      : withMojoValue(Object.freeze([
          ...left.before,
          Object.freeze({ kind: "expression", expression: left.value }),
          ...converted.before,
        ]), converted.value);
  }
  registerMojoTypeImports(selection.leftType, context);
  registerMojoTypeImports(selection.presentType, context);
  registerMojoTypeImports(selection.resultType, context);
  const optionalName = allocateMojoSyntheticName(context, "nullish_source");
  const resultName = allocateMojoSyntheticName(context, "nullish_value");
  const optionalPath: MojoExpression = Object.freeze({ kind: "path", path: optionalName });
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const presentValue = selection.kind === "optional"
    ? Object.freeze({
        kind: "method-call" as const,
        receiver: optionalPath,
        name: "value",
        arguments: Object.freeze([]),
      })
    : applyValueRefinement(
        optionalPath,
        selection.presentRefinement === undefined
          ? undefined
          : context.program.representations.narrowingFor(selection.presentRefinement),
        context,
      );
  if (presentValue === undefined) return undefined;
  const convertedPresent = convertMojoValue(
    withMojoValue(Object.freeze([]), presentValue),
    selection.presentConversion,
    context,
  );
  const convertedRight = convertMojoValue(right, selection.rightConversion, context);
  if (convertedPresent === undefined || convertedRight === undefined) return undefined;
  const condition = selection.kind === "optional"
    ? Object.freeze({
        kind: "construct" as const,
        type: Object.freeze({ kind: "source-primitive" as const, name: "bool" as const }),
        arguments: Object.freeze([{ value: optionalPath }]),
      })
    : unionPresenceTest(optionalPath, selection.presentType, context);
  if (condition === undefined) return undefined;
  return withMojoValue([
    ...left.before,
    Object.freeze({ kind: "variable", name: optionalName, type: selection.leftType, initializer: left.value }),
    Object.freeze({ kind: "variable", name: resultName, type: selection.resultType }),
    Object.freeze({
      kind: "if",
      condition,
      thenStatements: Object.freeze([
        ...convertedPresent.before,
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: convertedPresent.value }),
      ]),
      elseStatements: Object.freeze([
        ...convertedRight.before,
        Object.freeze({ kind: "assignment", operator: "=", left: resultPath, right: convertedRight.value }),
      ]),
    }),
  ], resultPath);
}

function unionPresenceTest(
  expression: MojoExpression,
  presentType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const members = presentType.kind === "union" ? presentType.members : [presentType];
  const tests = members.map((member): MojoExpression => {
    registerMojoTypeImports(member, context);
    return Object.freeze({
      kind: "method-call",
      receiver: expression,
      name: "isa",
      genericArguments: Object.freeze([{ kind: "type" as const, type: member }]),
      arguments: Object.freeze([]),
    });
  });
  return tests.length === 0
    ? undefined
    : tests.reduce((left, right) => Object.freeze({
        kind: "binary",
        operator: "or",
        left,
        right,
      }));
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
  const compileTime = conditionNode !== undefined &&
    isMojoCompileTimeCondition(conditionNode, context);
  const condition = conditionNode === undefined
    ? undefined
    : compileTime
      ? planMojoCompileTimeCondition(conditionNode, context, planValue)
      : planValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
  const whenTrue = trueNode === undefined ? undefined : planValue(trueNode, context, resultType);
  const whenFalse = falseNode === undefined ? undefined : planValue(falseNode, context, resultType);
  if (condition === undefined || whenTrue === undefined || whenFalse === undefined) return undefined;
  if (!compileTime && whenTrue.before.length === 0 && whenFalse.before.length === 0) {
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
      ...(compileTime ? { compileTime: true } : {}),
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
  const refinement = context.program.representations.narrowing(node);
  const plan = planValue(
    inner,
    context,
    refinement === undefined ? context.program.queries.expressionType(node) : undefined,
  );
  if (plan === undefined) return undefined;
  const value = applyValueRefinement(plan.value, refinement, context);
  return value === undefined ? undefined : withMojoValue(plan.before, value);
}

export function planMojoTypeTest(
  selection: MojoTypeTestSelection,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  if (selection.kind === "nullish-comparison") {
    const left = planValue(selection.left, context);
    const right = planValue(selection.right, context);
    const leftType = context.program.queries.expressionType(selection.left);
    const rightType = context.program.queries.expressionType(selection.right);
    if (left === undefined || right === undefined || leftType === undefined || rightType === undefined) {
      return undefined;
    }
    const ordered = orderMojoValues(Object.freeze([
      Object.freeze({ plan: left, type: leftType, role: "comparison_left" }),
      Object.freeze({ plan: right, type: rightType, role: "comparison_right" }),
    ]), context, true);
    if (selection.outcome.kind === "constant") {
      return withMojoValue(
        ordered.before,
        Object.freeze({ kind: "bool-literal", value: selection.outcome.value }),
      );
    }
    const operand = ordered.values[selection.outcome.operand === "left" ? 0 : 1]!;
    let equal: MojoExpression;
    if (selection.outcome.kind === "optional-absence") {
      equal = Object.freeze({
        kind: "unary",
        operator: "not",
        operand: Object.freeze({
          kind: "construct",
          type: Object.freeze({ kind: "source-primitive", name: "bool" }),
          arguments: Object.freeze([{ value: operand }]),
        }),
      });
    } else {
      const tests = selection.outcome.testedTypes.map((testedType): MojoExpression => {
        registerMojoTypeImports(testedType, context);
        return Object.freeze({
          kind: "method-call",
          receiver: operand,
          name: "isa",
          genericArguments: Object.freeze([{ kind: "type" as const, type: testedType }]),
          arguments: Object.freeze([]),
        });
      });
      equal = tests.reduce((leftTest, rightTest) => Object.freeze({
        kind: "binary",
        operator: "or",
        left: leftTest,
        right: rightTest,
      }));
    }
    return withMojoValue(
      ordered.before,
      selection.outcome.equal
        ? equal
        : Object.freeze({ kind: "unary", operator: "not", operand: equal }),
    );
  }
  const operand = planValue(selection.operand, context);
  if (operand === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_TYPE_TEST_OPERAND_NOT_PLANNED",
      "A checked type test requires one exact sealed Mojo operand plan.",
      selection.operand,
    );
    return undefined;
  }
  if (selection.kind === "constant") {
    const operandType = context.program.queries.expressionType(selection.operand);
    if (operandType === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_CONSTANT_TYPE_TEST_OPERAND_TYPE_MISSING",
        "A constant type-test result requires the exact sealed operand carrier.",
        selection.operand,
      );
      return undefined;
    }
    return withMojoValue(
      Object.freeze([
        ...operand.before,
        Object.freeze({
          kind: operandType.kind === "unit" ? "expression" as const : "discard" as const,
          expression: operand.value,
        }),
      ]),
      Object.freeze({ kind: "bool-literal", value: selection.value }),
    );
  }
  if (selection.kind === "project-dispatch") {
    const route = context.program.projectDispatch.downcastFor(
      selection.dispatchType,
      selection.testedType,
    );
    if (route === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_TYPE_TEST_ROUTE_MISSING",
        "A checked project type test has no exact sealed downcast route.",
        selection.operand,
      );
      return undefined;
    }
    registerMojoTypeImports(selection.sourceType, context);
    registerMojoTypeImports(selection.testedType, context);
    const ordered = orderMojoValues(Object.freeze([Object.freeze({
      plan: operand,
      type: selection.sourceType,
      role: "project_type_test_operand",
      stabilize: true,
    })]), context, true);
    const source = selection.sourceType.kind === "optional"
      ? Object.freeze({
          kind: "method-call" as const,
          receiver: ordered.values[0]!,
          name: "value",
          arguments: Object.freeze([]),
        })
      : ordered.values[0]!;
    const downcast: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver: source,
      name: route.name,
      arguments: Object.freeze([]),
    });
    const available: MojoExpression = Object.freeze({
      kind: "construct",
      type: Object.freeze({ kind: "source-primitive", name: "bool" }),
      arguments: Object.freeze([{ value: downcast }]),
    });
    return withMojoValue(
      ordered.before,
      selection.sourceType.kind === "optional"
        ? Object.freeze({
            kind: "binary",
            operator: "and",
            left: Object.freeze({
              kind: "construct",
              type: Object.freeze({ kind: "source-primitive", name: "bool" }),
              arguments: Object.freeze([{ value: ordered.values[0]! }]),
            }),
            right: available,
          })
        : available,
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
