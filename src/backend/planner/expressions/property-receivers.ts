import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { orderMojoValues, prepareMojoReceiver } from "./support.js";
import type { MojoValuePlanner, PreparedMojoReceiver } from "./support.js";
import { withMojoValue } from "./value-plan.js";

export function planMojoPropertyKeyEvaluation(
  selection: { readonly evaluatedKey?: Node },
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): readonly MojoStatement[] | undefined {
  if (selection.evaluatedKey === undefined) return Object.freeze([]);
  const key = planValue(selection.evaluatedKey, context);
  return key === undefined ? undefined : Object.freeze([
    ...key.before,
    Object.freeze({ kind: "discard", expression: key.value }),
  ]);
}

export function prepareMojoPropertyReceiver(
  selection: { readonly evaluatedKey?: Node },
  expression: Node,
  receiverType: MojoTargetTypeRef,
  optional: boolean,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PreparedMojoReceiver | undefined {
  const receiver = prepareMojoReceiver(expression, receiverType, optional, context, planValue);
  if (receiver === undefined || selection.evaluatedKey === undefined) return receiver;
  return withMojoPropertyKeyEvaluation(selection, receiver, receiverType, context, planValue);
}

export function withMojoPropertyKeyEvaluation(
  selection: { readonly evaluatedKey?: Node },
  receiver: PreparedMojoReceiver,
  receiverType: MojoTargetTypeRef,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PreparedMojoReceiver | undefined {
  if (selection.evaluatedKey === undefined) return receiver;
  const key = planMojoPropertyKeyEvaluation(selection, context, planValue);
  if (key === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver.plan, type: receiverType, role: "property_receiver" }),
  ], context, true);
  return Object.freeze({
    ...receiver,
    plan: withMojoValue([...ordered.before, ...key], ordered.values[0]!),
  });
}
