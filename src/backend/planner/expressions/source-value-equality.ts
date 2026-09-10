import type { MojoTypeTestSelection } from "../../../analysis/program/model.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoSourceValueEquality(
  selection: Extract<MojoTypeTestSelection, { kind: "source-value-equality" }>,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const left = planValue(selection.left, context, selection.operandType);
  const right = planValue(selection.right, context, selection.operandType);
  if (left === undefined || right === undefined) return undefined;
  const ordered = orderMojoValues([
    { plan: left, type: selection.operandType, role: "equality_left" },
    { plan: right, type: selection.operandType, role: "equality_right" },
  ], context);
  const equality = Object.freeze({
    kind: "call" as const,
    callee: mojoModuleMemberExpression(context, ["tsonic_js", "object"], "strict_equal"),
    arguments: Object.freeze(ordered.values.map((value) => Object.freeze({ value }))),
  });
  return withMojoValue(ordered.before, selection.equal ? equality : {
    kind: "unary", operator: "not", operand: equality,
  });
}
