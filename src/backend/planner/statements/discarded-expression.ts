import type { Node } from "@tsonic/tsts";
import type { MojoStatement } from "../../target-ast/index.js";
import { planMojoValue } from "../expressions/value.js";
import type { MojoPlanningContext } from "../program/context.js";
import { appendMojoPlanningDiagnostic } from "../program/context.js";

export function planDiscardedMojoExpression(
  sourceExpression: Node,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const expression = planMojoValue(sourceExpression, context);
  if (expression === undefined) return undefined;
  const resultType = context.program.queries.expressionType(sourceExpression);
  if (resultType === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_DISCARDED_EXPRESSION_TYPE_MISSING",
      "An authored expression statement requires one exact sealed result carrier.",
      sourceExpression,
    );
    return undefined;
  }
  return Object.freeze([
    ...expression.before,
    resultType.kind === "unit" || resultType.kind === "never"
      ? {
          kind: "expression",
          expression: expression.value,
          ...(resultType.kind === "never" ? { neverReturns: true } : {}),
        }
      : { kind: "discard", expression: expression.value },
  ]);
}
