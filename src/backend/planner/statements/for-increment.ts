import type { Node } from "@tsonic/tsts";
import type { MojoStatement } from "../../target-ast/index.js";
import { planMojoValue } from "../expressions/value.js";
import { planMojoAssignment } from "../expressions/assignments.js";
import { planMojoUpdate } from "../expressions/updates.js";
import type { MojoPlanningContext } from "../program/context.js";

export function planForIncrement(
  incrementor: Node | undefined,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (incrementor === undefined) return Object.freeze([]);
  const assignment = planMojoAssignment(incrementor, context, planMojoValue);
  if (assignment !== undefined) return Object.freeze([
    ...assignment.before,
    assignment.statement,
  ]);
  const update = planMojoUpdate(incrementor, context, planMojoValue);
  if (update !== undefined) return Object.freeze([
    ...update.before,
    update.statement,
  ]);
  const expression = planMojoValue(incrementor, context);
  return expression === undefined
    ? undefined
    : Object.freeze([...expression.before, { kind: "expression", expression: expression.value }]);
}
