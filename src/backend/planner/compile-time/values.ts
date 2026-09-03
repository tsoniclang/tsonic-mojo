import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "../../../analysis/program/call-model.js";
import type { MojoPlanningContext } from "../program/context.js";
import type { MojoValuePlanner } from "../expressions/support.js";
import { mojoValue } from "../expressions/value-plan.js";
import type { MojoValuePlan } from "../expressions/value-plan.js";

type MojoSourceIntrinsicSelection = Extract<MojoCallSelection, { readonly kind: "source-intrinsic" }>;

export function mojoSourceIntrinsicSelection(
  node: Node,
  context: MojoPlanningContext,
): MojoSourceIntrinsicSelection | undefined {
  const selection = context.program.queries.callSelection(node);
  return selection?.kind === "source-intrinsic" ? selection : undefined;
}

export function planMojoCompileTimeInitializer(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = mojoSourceIntrinsicSelection(node, context);
  if (selection?.operation === "comptime-type") {
    return selection.value === undefined
      ? undefined
      : mojoValue(Object.freeze({ kind: "generic-argument-value", value: selection.value }));
  }
  return selection?.operation === "comptime-value" && selection.operand !== undefined
    ? planValue(selection.operand, context, selection.resultType)
    : undefined;
}

export function isMojoCompileTimeCondition(
  node: Node,
  context: MojoPlanningContext,
): boolean {
  return mojoSourceIntrinsicSelection(node, context)?.operation === "comptime-condition";
}

export function planMojoCompileTimeCondition(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = mojoSourceIntrinsicSelection(node, context);
  return selection?.operation === "comptime-condition" && selection.operand !== undefined
    ? planValue(selection.operand, context, selection.resultType)
    : undefined;
}

export function isMojoCompileTimeIteration(
  node: Node,
  context: MojoPlanningContext,
): boolean {
  return mojoSourceIntrinsicSelection(node, context)?.operation === "comptime-iteration";
}
