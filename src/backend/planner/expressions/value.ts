import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  withMojoErrorType,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  planMojoCall,
} from "./calls.js";
import {
  planMojoElement,
  planMojoDelete,
} from "./elements.js";
import { planMojoProperty } from "./properties.js";
import { planMojoLeafExpression } from "./leaves.js";
import { mojoNumericLiteralCanInitialize } from "../../../target-model/types/numeric-literals.js";
import {
  convertMojoValue,
  planProviderConstant,
  requiredConversion,
} from "./support.js";
import { mojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoCallableExpression } from "./callables.js";
import {
  planAwait,
  planConditional,
  planErasedExpression,
  planPrefixUnary,
} from "./conditional-values.js";
import { planMojoTemplateExpression } from "./template-strings.js";
import { adaptMojoValueErrorDomain } from "./error-domains.js";
import {
  planArrayLiteral,
  planBinary,
  planObjectLiteral,
  planParenthesized,
} from "./composite-values.js";
import { mutationAsValue } from "./mutation-plan.js";
import { planMojoIntrinsicExpression } from "./intrinsic-expressions.js";
import { planMojoAssignment } from "./assignments.js";
import { planMojoUpdate } from "./updates.js";

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
  const sourceErrorType = context.program.queries.expressionErrorType(node);
  const evaluationContext = withMojoErrorType(context, sourceErrorType);
  const actualType = context.program.queries.expressionType(node);
  const conversion = expectedType === undefined || actualType === undefined
    ? undefined
    : requiredConversion(node, expectedType, evaluationContext);
  if (expectedType !== undefined && actualType !== undefined && conversion === undefined) {
    return undefined;
  }
  const inlineCallableAdaptation = conversion?.kind === "callable-adapt" &&
    conversion.error !== "erase" &&
    (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node));
  let plan: MojoValuePlan | undefined;
  if (ast.is.IsArrayLiteralExpression(node)) {
    plan = planArrayLiteral(node, evaluationContext, planMojoValue);
  } else if (ast.kindName(node) === "KindTemplateExpression") {
    plan = planMojoTemplateExpression(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsObjectLiteralExpression(node)) {
    plan = planObjectLiteral(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsParenthesizedExpression(node)) {
    plan = planParenthesized(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsDeleteExpression(node)) {
    plan = planMojoDelete(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsTypeOfExpression(node) || ast.is.IsVoidExpression(node)) {
    plan = planMojoIntrinsicExpression(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsBinaryExpression(node)) {
    const assignment = planMojoAssignment(node, evaluationContext, planMojoValue, "value");
    plan = assignment === undefined
      ? planBinary(node, evaluationContext, planMojoValue)
      : mutationAsValue(assignment);
  } else if (ast.is.IsPrefixUnaryExpression(node) || ast.is.IsPostfixUnaryExpression(node)) {
    const update = planMojoUpdate(node, evaluationContext, planMojoValue, "value");
    plan = update === undefined && ast.is.IsPrefixUnaryExpression(node)
      ? planPrefixUnary(node, evaluationContext, planMojoValue)
      : update === undefined
        ? undefined
        : mutationAsValue(update);
  } else if (ast.is.IsConditionalExpression(node)) {
    plan = planConditional(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsAwaitExpression(node)) {
    plan = planAwait(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) ||
    ast.is.IsNonNullExpression(node) || ast.is.IsSatisfiesExpression(node)) {
    plan = planErasedExpression(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsArrowFunction(node) || ast.is.IsFunctionExpression(node)) {
    plan = planMojoCallableExpression(
      node,
      evaluationContext,
      planMojoValue,
      inlineCallableAdaptation && conversion?.kind === "callable-adapt" &&
          conversion.targetType.kind === "callable"
        ? conversion.targetType
        : undefined,
    );
  } else if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
    plan = planMojoCall(node, evaluationContext, planMojoValue);
  } else if (ast.is.IsPropertyAccessExpression(node)) {
    plan = planMojoProperty(node, evaluationContext, planMojoValue, "read");
  } else if (ast.is.IsElementAccessExpression(node)) {
    plan = planMojoElement(node, evaluationContext, planMojoValue, "read");
  } else {
    const selectedValue = context.program.queries.valueSelection(node);
    if (selectedValue !== undefined) {
      plan = planProviderConstant(
        selectedValue.operation,
        selectedValue.resultConversion,
        evaluationContext,
      );
    } else {
      const directNumericTarget = ast.is.IsNumericLiteral(node) &&
          expectedType !== undefined && conversion?.kind === "primitive-cast" &&
          mojoNumericLiteralCanInitialize(ast.text(node), expectedType)
        ? expectedType
        : undefined;
      const expression = planMojoLeafExpression(node, evaluationContext, directNumericTarget);
      plan = expression === undefined ? undefined : mojoValue(expression);
    }
  }
  if (plan === undefined) return undefined;
  const directNumericConversion = ast.is.IsNumericLiteral(node) &&
    expectedType !== undefined && conversion?.kind === "primitive-cast" &&
    mojoNumericLiteralCanInitialize(ast.text(node), expectedType);
  const converted = expectedType === undefined || actualType === undefined ||
      inlineCallableAdaptation || directNumericConversion
    ? plan
    : conversion === undefined
      ? undefined
      : convertMojoValue(plan, conversion, evaluationContext);
  if (converted === undefined) return undefined;
  const resultType = expectedType ?? actualType;
  return resultType === undefined
    ? converted
    : adaptMojoValueErrorDomain(
        converted,
        resultType,
        sourceErrorType,
        context.errorType,
        node,
        context,
      );
}
