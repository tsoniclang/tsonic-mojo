import type { Node } from "@tsonic/tsts";
import type { MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { prepareMojoReceiver } from "./receivers.js";
import type { PreparedMojoReceiver } from "./receivers.js";
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
  optional: boolean,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PreparedMojoReceiver | undefined {
  const receiver = prepareMojoReceiver(expression, optional, context, planValue);
  if (receiver === undefined || selection.evaluatedKey === undefined) return receiver;
  return withMojoPropertyKeyEvaluation(selection, receiver, context, planValue);
}

export function withMojoPropertyKeyEvaluation(
  selection: { readonly evaluatedKey?: Node },
  receiver: PreparedMojoReceiver,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PreparedMojoReceiver | undefined {
  if (selection.evaluatedKey === undefined) return receiver;
  const key = planMojoPropertyKeyEvaluation(selection, context, planValue);
  if (key === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver.plan, type: receiver.type, role: "property_receiver",
      use: receiver.type.kind === "reference" ? "location" : "snapshot" }),
  ], context, true);
  return Object.freeze({
    ...receiver,
    plan: withMojoValue([...ordered.before, ...key], ordered.values[0]!),
  });
}
