import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  convertMojoValue,
  finishOptionalMojoOperation,
  orderMojoValues,
  prepareMojoReceiver,
} from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { applyValueRefinement } from "./leaves.js";

export function planMojoElement(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
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
  const sourceReceiverType = selection.kind === "provider"
    ? selection.sourceReceiverType
    : selection.receiverType;
  const preparedReceiver = prepareMojoReceiver(
    selection.receiver,
    sourceReceiverType,
    selection.optionalChain,
    context,
    planValue,
  );
  const receiver = preparedReceiver === undefined
    ? undefined
    : selection.kind === "provider"
      ? convertMojoValue(preparedReceiver.plan, selection.receiverConversion, context)
      : preparedReceiver.plan;
  const rawIndex = planValue(selection.index, context);
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
  const receiverType = selection.kind === "provider" ? operation?.receiverType : selection.receiverType;
  const indexType = selection.kind === "provider" ? operation?.parameterTypes[0] : selection.indexType;
  if (receiverType === undefined || indexType === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver, type: receiverType, role: "element_receiver" }),
    Object.freeze({ plan: index, type: indexType, role: "element_index" }),
  ], context, stabilizeComponents);
  const indexedReceiver: MojoExpression = selection.kind !== "project-index"
    ? ordered.values[0]!
    : {
        kind: "member",
        receiver: {
          kind: "postfix-deref",
          expression: { kind: "member", receiver: ordered.values[0]!, name: "_state" },
        },
        name: selection.storageName,
      };
  const access: MojoExpression = selection.kind === "provider" &&
      operation?.target.kind === "index-read" && operation.target.access.kind === "method"
    ? {
        kind: "method-call",
        receiver: indexedReceiver,
        name: operation.target.access.name,
        arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
      }
    : {
        kind: "element",
        receiver: indexedReceiver,
        index: ordered.values[1]!,
      };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(ordered.before, access)
    : convertMojoValue(
        withMojoValue(ordered.before, access),
        selection.readResultConversion,
        context,
      );
  if (operationPlan === undefined) return undefined;
  const finished = finishOptionalMojoOperation(node, preparedReceiver, operationPlan, context);
  if (finished === undefined) return undefined;
  return withMojoValue(
    finished.before,
    applyValueRefinement(
      finished.value,
      context.program.queries.valueRefinement(node),
      context,
    ),
  );
}
