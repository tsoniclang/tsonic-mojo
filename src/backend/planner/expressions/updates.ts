import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { appendMojoPlanningDiagnostic } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  planMojoElement,
  planMojoProjectElementWrite,
  projectElementUsesMethodWrite,
  planMojoProviderElementMethodWrite,
  providerElementUsesMethodWrite,
} from "./elements.js";
import {
  planMojoProjectPropertyWrite,
  projectPropertyUsesMethodWrite,
  planMojoProviderPropertyMethodWrite,
} from "./property-writes.js";
import { planMojoProperty } from "./properties.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, mojoValue } from "./value-plan.js";
import {
  materializeMojoMutation,
} from "./mutation-plan.js";
import type {
  MojoPlannedMutation,
  MojoPreparedMutation,
} from "./mutation-plan.js";
import { plannedLocationExpression } from "./mutation-locations.js";

export type PlannedMojoAssignment = MojoPlannedMutation;

export function planMojoUpdate(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
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
              value: consumeMojoValue(value, type, context.program.lifecycle),
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
              value: consumeMojoValue(assignedValue, type, context.program.lifecycle),
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
      planValue,
      node,
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
      planValue,
      node,
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
      planValue,
      node,
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
      planValue,
      node,
    );
    return prepared === undefined
      ? undefined
      : materializeUpdate(prepared, node, operand, resultUse, context);
  }
  const left = ast.is.IsPropertyAccessExpression(operand)
    ? planMojoProperty(operand, context, planValue, "write", resultUse === "value")
    : ast.is.IsElementAccessExpression(operand)
      ? planMojoElement(operand, context, planValue, "write", resultUse === "value")
      : planValue(operand, context);
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
