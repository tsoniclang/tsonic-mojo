import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
} from "@tsonic/target-api/source";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  planMojoElement,
  planMojoProjectElementWrite,
  projectElementUsesMethodWrite,
  planMojoProviderElementWrite,
  providerElementUsesWriteOperation,
} from "./elements.js";
import {
  planMojoProjectPropertyWrite,
  projectPropertyUsesMethodWrite,
  planMojoProviderPropertyWrite,
} from "./property-writes.js";
import { planMojoProperty } from "./properties.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { consumeMojoValue } from "./value-plan.js";
import { materializeMojoMutation, prepareMojoMutationValue } from "./mutation-plan.js";
import { planMojoStaticProviderWrite } from "./static-property-writes.js";
import type {
  MojoPlannedMutation,
  MojoPreparedMutation,
} from "./mutation-plan.js";
import { plannedLocationExpression } from "./mutation-locations.js";
import { planMojoCompoundValue } from "./numeric.js";
import { mojoValue } from "./value-plan.js";

const assignmentOperatorText = new Map<string, string>([
  ["KindEqualsToken", "="],
  ["KindPlusEqualsToken", "+="],
  ["KindMinusEqualsToken", "-="],
  ["KindAsteriskEqualsToken", "*="],
  ["KindSlashEqualsToken", "/="],
  ["KindPercentEqualsToken", "%="],
  ["KindAsteriskAsteriskEqualsToken", "**="],
  ["KindAmpersandEqualsToken", "&="],
  ["KindBarEqualsToken", "|="],
  ["KindCaretEqualsToken", "^="],
  ["KindLessThanLessThanEqualsToken", "<<="],
  ["KindGreaterThanGreaterThanEqualsToken", ">>="],
  ["KindGreaterThanGreaterThanGreaterThanEqualsToken", ">>>="],
]);

export type PlannedMojoAssignment = MojoPlannedMutation;

export function planMojoAssignment(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
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
  const numeric = context.program.queries.intrinsicExpressionSelection(node);
  const rightType = numeric?.kind === "numeric"
    ? context.program.queries.expressionType(rightNode)
    : context.program.queries.expressionType(node);
  const right = planValue(rightNode, context, numeric?.kind === "numeric" ? undefined : rightType);
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
      planValue,
      node,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (projectElementUsesMethodWrite(element, context)) {
    const prepared = planMojoProjectElementWrite(
      leftNode,
      right,
      operator,
      context,
      planValue,
      node,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (providerElementUsesWriteOperation(element)) {
    const prepared = planMojoProviderElementWrite(
      leftNode,
      right,
      operator,
      context,
      planValue,
      node,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (property?.kind === "provider" &&
    property.writeOperation?.target.kind === "property-write") {
    const prepared = planMojoProviderPropertyWrite(
      leftNode,
      right,
      operator,
      context,
      planValue,
      node,
    );
    return materializeAssignment(prepared, node, resultUse, context);
  }
  if (property?.kind === "provider-static") {
    const prepared = planMojoStaticProviderWrite(leftNode, right, operator, node, context, planValue);
    return materializeAssignment(prepared, node, resultUse, context);
  }
  const mutationValue = prepareMojoMutationValue(node, targetType, context);
  const storage = plannedLocationExpression(leftNode, context);
  if (storage !== undefined) {
    const current: MojoExpression = Object.freeze({ kind: "method-call", receiver: storage, name: "read", arguments: Object.freeze([]) });
    const ordered = operator === "=" ? undefined : orderMojoValues([
      Object.freeze({ plan: mojoValue(current), type: leftType ?? targetType, role: "compound_left" }),
      Object.freeze({ plan: right, type: rightType ?? targetType, role: "compound_right" }),
    ], context, true);
    const value: MojoExpression = operator === "="
      ? right.value
      : planMojoCompoundValue(node, operator, ordered!.values[0]!, ordered!.values[1]!, context);
    const prepared: MojoPreparedMutation = Object.freeze({
      before: ordered?.before ?? right.before,
      assignedValue: value,
      ...mutationValue,
      valuePassing: "consume",
      createWrite(argumentValue: MojoExpression): MojoStatement {
        return Object.freeze({
          kind: "expression",
          expression: Object.freeze({
            kind: "method-call",
            receiver: storage,
            name: "write",
            arguments: Object.freeze([Object.freeze({
              value: consumeMojoValue(argumentValue, targetType, context.program.lifecycle),
            })]),
          }),
        });
      },
    });
    return materializeAssignment(prepared, node, resultUse, context);
  }
  const stabilizeLocation = right.before.length !== 0 || resultUse === "value" || numeric?.kind === "numeric";
  const left = property !== undefined
    ? planMojoProperty(leftNode, context, planValue, "write", stabilizeLocation)
    : ast.is.IsElementAccessExpression(leftNode)
      ? planMojoElement(leftNode, context, planValue, "write", stabilizeLocation)
      : planValue(leftNode, context);
  if (left === undefined) return undefined;
  const before: MojoStatement[] = [...left.before];
  let plannedOperator = operator;
  let plannedRight = right.value;
  if (operator !== "=" && (right.before.length !== 0 || numeric?.kind === "numeric")) {
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
    plannedRight = planMojoCompoundValue(node, operator, priorValue, right.value, context);
  }
  before.push(...right.before);
  const prepared: MojoPreparedMutation = Object.freeze({
    before: Object.freeze(before),
    assignedValue: plannedOperator === "="
      ? plannedRight
      : planMojoCompoundValue(node, plannedOperator, left.value, plannedRight, context),
    ...mutationValue,
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
