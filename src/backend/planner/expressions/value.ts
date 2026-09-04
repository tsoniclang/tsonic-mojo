import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoBindingPlanOverride,
  mojoModuleMemberExpression,
  withMojoErrorType,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  planMojoCall,
} from "./calls.js";
import {
  planMojoElement,
  planMojoDelete,
  planMojoProjectElementWrite,
  projectElementUsesMethodWrite,
  planMojoProviderElementMethodWrite,
  providerElementUsesMethodWrite,
} from "./elements.js";
import {
  planMojoProjectPropertyWrite,
  projectPropertyUsesMethodWrite,
  planMojoProperty,
  planMojoProviderPropertyMethodWrite,
} from "./properties.js";
import { planMojoLeafExpression } from "./leaves.js";
import { mojoNumericLiteralCanInitialize } from "../../../target-model/types/numeric-literals.js";
import {
  convertMojoValue,
  orderMojoValues,
  planProviderConstant,
  requiredConversion,
} from "./support.js";
import { registerMojoTypeImports } from "../types/imports.js";
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
import {
  materializeMojoMutation,
  mutationAsValue,
} from "./mutation-plan.js";
import type {
  MojoPlannedMutation,
  MojoPreparedMutation,
} from "./mutation-plan.js";
import { planMojoIntrinsicExpression } from "./intrinsic-expressions.js";

const assignmentOperatorText = new Map<string, string>([
  ["KindEqualsToken", "="],
  ["KindPlusEqualsToken", "+="],
  ["KindMinusEqualsToken", "-="],
  ["KindAsteriskEqualsToken", "*="],
  ["KindSlashEqualsToken", "/="],
]);

export type PlannedMojoAssignment = MojoPlannedMutation;

export function planMojoUpdate(
  node: Node,
  context: MojoPlanningContext,
  resultUse: "discard" | "value" = "discard",
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
    const type = context.program.queries.expressionType(operand);
    if (type === undefined || type.kind !== "source-primitive" ||
      type.name === "bool" || type.name === "char") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_UPDATE_TARGET_UNSUPPORTED",
        "Increment and decrement require one exact mutable numeric Mojo location.",
        node,
      );
      return undefined;
    }
    const current = orderMojoValues([Object.freeze({
      plan: mojoValue(Object.freeze({
        kind: "method-call" as const,
        receiver: storage,
        name: "read",
        arguments: Object.freeze([]),
      })),
      type,
      role: "update_previous",
    })], context, resultUse === "value");
    const previousValue = current.values[0]!;
    const assignedValue: MojoExpression = Object.freeze({
      kind: "binary",
      operator: operator.slice(0, -1),
      left: previousValue,
      right: Object.freeze({ kind: "number-literal", text: "1" }),
    });
    const prepared: MojoPreparedMutation = Object.freeze({
      before: current.before,
      assignedValue,
      assignedType: type,
      previousValue,
      valuePassing: "consume",
      createWrite(value: MojoExpression): MojoStatement {
        return Object.freeze({
          kind: "expression",
          expression: Object.freeze({
            kind: "method-call",
            receiver: storage,
            name: "write",
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({ kind: "consume", expression: value }),
            })]),
          }),
        });
      },
      createDiscardWrite(): MojoStatement {
        return Object.freeze({
          kind: "expression",
          expression: Object.freeze({
            kind: "method-call",
            receiver: storage,
            name: "write",
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({ kind: "consume", expression: assignedValue }),
            })]),
          }),
        });
      },
    });
    return materializeUpdate(prepared, node, operand, resultUse, context);
  }
  const property = context.program.queries.propertySelection(operand);
  const element = context.program.queries.elementSelection(operand);
  if (property !== undefined && projectPropertyUsesMethodWrite(property, context)) {
    const type = property.kind === "project-field"
      ? property.fieldType
      : property.kind === "project-accessor"
        ? property.writeType ?? property.readType
        : undefined;
    if (type === undefined || type.kind !== "source-primitive" ||
      type.name === "bool" || type.name === "char") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_UPDATE_TARGET_UNSUPPORTED",
        "Increment and decrement require one exact mutable numeric Mojo location.",
        node,
      );
      return undefined;
    }
    const prepared = planMojoProjectPropertyWrite(
      operand,
      mojoValue(Object.freeze({ kind: "number-literal", text: "1" })),
      operator,
      context,
      planMojoValue,
    );
    return prepared === undefined
      ? undefined
      : materializeUpdate(prepared, node, operand, resultUse, context);
  }
  if (projectElementUsesMethodWrite(element, context)) {
    const type = element?.writeType ?? element?.readType;
    if (type === undefined || type.kind !== "source-primitive" ||
      type.name === "bool" || type.name === "char") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_UPDATE_TARGET_UNSUPPORTED",
        "Increment and decrement require one exact mutable numeric Mojo location.",
        node,
      );
      return undefined;
    }
    const prepared = planMojoProjectElementWrite(
      operand,
      mojoValue(Object.freeze({ kind: "number-literal", text: "1" })),
      operator,
      context,
      planMojoValue,
    );
    return prepared === undefined
      ? undefined
      : materializeUpdate(prepared, node, operand, resultUse, context);
  }
  if (providerElementUsesMethodWrite(element)) {
    const type = element?.writeType ?? element?.readType;
    if (type === undefined || type.kind !== "source-primitive" ||
      type.name === "bool" || type.name === "char") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_UPDATE_TARGET_UNSUPPORTED",
        "Increment and decrement require one exact mutable numeric Mojo location.",
        node,
      );
      return undefined;
    }
    const prepared = planMojoProviderElementMethodWrite(
      operand,
      mojoValue(Object.freeze({ kind: "number-literal", text: "1" })),
      operator,
      context,
      planMojoValue,
    );
    return prepared === undefined
      ? undefined
      : materializeUpdate(prepared, node, operand, resultUse, context);
  }
  if (property?.kind === "provider" &&
    property.writeOperation?.target.kind === "property-write" &&
    property.writeOperation.target.access.kind === "method") {
    const type = property.sourceWriteType;
    if (type === undefined || type.kind !== "source-primitive" ||
      type.name === "bool" || type.name === "char") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_UPDATE_TARGET_UNSUPPORTED",
        "Increment and decrement require one exact mutable numeric Mojo location.",
        node,
      );
      return undefined;
    }
    const prepared = planMojoProviderPropertyMethodWrite(
      operand,
      mojoValue(Object.freeze({ kind: "number-literal", text: "1" })),
      operator,
      context,
      planMojoValue,
    );
    return prepared === undefined
      ? undefined
      : materializeUpdate(prepared, node, operand, resultUse, context);
  }
  const left = ast.is.IsPropertyAccessExpression(operand)
    ? planMojoProperty(operand, context, planMojoValue, "write", resultUse === "value")
    : ast.is.IsElementAccessExpression(operand)
      ? planMojoElement(operand, context, planMojoValue, "write", resultUse === "value")
      : planMojoValue(operand, context);
  const providerProperty = property?.kind === "provider" || property?.kind === "provider-static"
    ? property
    : undefined;
  const providerElement = element?.kind === "provider" ? element : undefined;
  const sourceWriteType = providerProperty?.sourceWriteType ?? providerElement?.sourceWriteType;
  const targetWriteType = providerProperty?.targetWriteType ?? providerElement?.targetWriteType;
  const providerWriteOperation = providerProperty?.writeOperation ?? providerElement?.writeOperation;
  if (providerWriteOperation !== undefined &&
    (sourceWriteType === undefined || targetWriteType === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_UPDATE_WRITE_CONVERSION_MISSING",
      "Increment and decrement require a sealed source-write carrier and target-write conversion.",
      node,
    );
    return undefined;
  }
  const type = sourceWriteType ?? element?.writeType ?? context.program.queries.expressionType(operand);
  if (sourceWriteType !== undefined && targetWriteType !== undefined &&
    !mojoTargetTypeEquals(sourceWriteType, targetWriteType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_UPDATE_WRITE_CONVERSION_UNSUPPORTED",
      "Increment and decrement require an identity conversion from the exact source write carrier to the target location carrier.",
      node,
    );
    return undefined;
  }
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
  const previous = orderMojoValues([Object.freeze({
    plan: mojoValue(left.value),
    type,
    role: "update_previous",
  })], context, resultUse === "value");
  const previousValue = previous.values[0]!;
  const assignedValue: MojoExpression = Object.freeze({
    kind: "binary",
    operator: operator.slice(0, -1),
    left: previousValue,
    right: Object.freeze({ kind: "number-literal", text: "1" }),
  });
  const prepared: MojoPreparedMutation = Object.freeze({
    before: Object.freeze([...left.before, ...previous.before]),
    assignedValue,
    assignedType: type,
    previousValue,
    valuePassing: "assign",
    createWrite(value: MojoExpression): MojoStatement {
      return Object.freeze({ kind: "assignment", operator: "=", left: left.value, right: value });
    },
    createDiscardWrite(): MojoStatement {
      return Object.freeze({
        kind: "assignment",
        operator,
        left: left.value,
        right: Object.freeze({ kind: "number-literal", text: "1" }),
      });
    },
  });
  return materializeUpdate(prepared, node, operand, resultUse, context);
}

function materializeUpdate(
  prepared: MojoPreparedMutation,
  node: Node,
  operand: Node,
  resultUse: "discard" | "value",
  context: MojoPlanningContext,
): MojoPlannedMutation | undefined {
  const postfix = context.program.source.ast.is.IsPostfixUnaryExpression(node);
  const result = resultUse === "discard" ? "discard" : postfix ? "previous" : "assigned";
  return materializeMojoMutation(
    prepared,
    result,
    context.program.queries.expressionType(node) ?? context.program.queries.expressionType(operand),
    node,
    context,
  );
}

export function planMojoAssignment(
  node: Node,
  context: MojoPlanningContext,
  resultUse: "discard" | "value" = "discard",
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
  const targetWriteType = property?.kind === "provider" || property?.kind === "provider-static"
    ? property.targetWriteType
    : property?.kind === "project-method" ? property.callableType
    : property?.kind === "project-accessor" ? property.writeType
    : element?.kind === "provider" ? element.targetWriteType : element?.writeType;
  const providerProperty = property?.kind === "provider" || property?.kind === "provider-static"
    ? property
    : undefined;
  const providerElement = element?.kind === "provider" ? element : undefined;
  const sourceWriteType = providerProperty?.sourceWriteType ?? providerElement?.sourceWriteType;
  const providerWriteOperation = providerProperty?.writeOperation ?? providerElement?.writeOperation;
  if (providerWriteOperation !== undefined &&
    (sourceWriteType === undefined || targetWriteType === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_PROPERTY_WRITE_CONVERSION_MISSING",
      "Provider assignment has no sealed source-write carrier and target-write conversion.",
      leftNode,
    );
    return undefined;
  }
  if (operator !== "=" && sourceWriteType !== undefined && targetWriteType !== undefined &&
    !mojoTargetTypeEquals(sourceWriteType, targetWriteType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_COMPOUND_WRITE_CONVERSION_UNSUPPORTED",
      "Provider compound assignment requires an identity source-to-target write conversion.",
      leftNode,
    );
    return undefined;
  }
  const right = planMojoValue(rightNode, context, targetWriteType ?? leftType);
  if (right === undefined) return undefined;
  const targetType = targetWriteType ?? leftType;
  if (targetType === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ASSIGNMENT_WRITE_CARRIER_MISSING",
      "Assignment requires one exact sealed target write carrier.",
      leftNode,
    );
    return undefined;
  }
  if (projectPropertyUsesMethodWrite(property, context)) {
    const prepared = planMojoProjectPropertyWrite(
      leftNode,
      right,
      operator,
      context,
      planMojoValue,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (projectElementUsesMethodWrite(element, context)) {
    const prepared = planMojoProjectElementWrite(
      leftNode,
      right,
      operator,
      context,
      planMojoValue,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (providerElementUsesMethodWrite(element)) {
    const prepared = planMojoProviderElementMethodWrite(
      leftNode,
      right,
      operator,
      context,
      planMojoValue,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (property?.kind === "provider" &&
    property.writeOperation?.target.kind === "property-write" &&
    property.writeOperation.target.access.kind === "method") {
    const prepared = planMojoProviderPropertyMethodWrite(
      leftNode,
      right,
      operator,
      context,
      planMojoValue,
    );
    return materializeAssignment(prepared, node, resultUse, context);
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
    const target = write.target;
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
    const prepared: MojoPreparedMutation = Object.freeze({
      before: Object.freeze(before),
      assignedValue: value,
      assignedType: write.parameterTypes[0]!,
      valuePassing: target.value.convention === "var" ? "consume" : "borrow",
      createWrite(argumentValue: MojoExpression): MojoStatement {
        const argument = target.value.convention === "var"
          ? Object.freeze({ kind: "consume" as const, expression: argumentValue })
          : argumentValue;
        return Object.freeze({
          kind: "expression",
          expression: Object.freeze({
            kind: "call",
            callee: mojoModuleMemberExpression(
              context,
              target.modulePath,
              target.name,
            ),
            arguments: Object.freeze([Object.freeze({
              value: argument,
              ...(target.value.position === "keyword"
                ? { name: target.value.nativeName! }
                : {}),
            })]),
          }),
        });
      },
    });
    return materializeAssignment(prepared, node, resultUse, context);
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
    const prepared: MojoPreparedMutation = Object.freeze({
      before: right.before,
      assignedValue: value,
      assignedType: targetType,
      valuePassing: "consume",
      createWrite(argumentValue: MojoExpression): MojoStatement {
        return Object.freeze({
          kind: "expression",
          expression: Object.freeze({
            kind: "method-call",
            receiver: storage,
            name: "write",
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({ kind: "consume", expression: argumentValue }),
            })]),
          }),
        });
      },
    });
    return materializeAssignment(prepared, node, resultUse, context);
  }
  const stabilizeLocation = right.before.length !== 0 || resultUse === "value";
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
  const prepared: MojoPreparedMutation = Object.freeze({
    before: Object.freeze(before),
    assignedValue: plannedOperator === "="
      ? plannedRight
      : Object.freeze({
          kind: "binary",
          operator: plannedOperator.slice(0, -1),
          left: left.value,
          right: plannedRight,
        }),
    assignedType: targetType,
    valuePassing: "assign",
    createWrite(value: MojoExpression): MojoStatement {
      return Object.freeze({ kind: "assignment", operator: "=", left: left.value, right: value });
    },
    createDiscardWrite(): MojoStatement {
      return Object.freeze({
        kind: "assignment",
        operator: plannedOperator,
        left: left.value,
        right: plannedRight,
      });
    },
  });
  return materializeAssignment(prepared, node, resultUse, context);
}

function materializeAssignment(
  prepared: MojoPreparedMutation | undefined,
  node: Node,
  resultUse: "discard" | "value",
  context: MojoPlanningContext,
): MojoPlannedMutation | undefined {
  return prepared === undefined
    ? undefined
    : materializeMojoMutation(
        prepared,
        resultUse === "value" ? "assigned" : "discard",
        context.program.queries.expressionType(node),
        node,
        context,
      );
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
    const assignment = planMojoAssignment(node, evaluationContext, "value");
    plan = assignment === undefined
      ? planBinary(node, evaluationContext, planMojoValue)
      : mutationAsValue(assignment);
  } else if (ast.is.IsPrefixUnaryExpression(node) || ast.is.IsPostfixUnaryExpression(node)) {
    const update = planMojoUpdate(node, evaluationContext, "value");
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
