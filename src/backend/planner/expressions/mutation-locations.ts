import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../../target-ast/index.js";
import { mojoBindingPlanOverride } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";

export function plannedLocationExpression(
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

