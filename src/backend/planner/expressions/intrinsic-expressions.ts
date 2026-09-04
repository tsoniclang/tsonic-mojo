import type { Node } from "@tsonic/tsts";
import type { MojoStatement } from "../../target-ast/index.js";
import { appendMojoPlanningDiagnostic } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import type { MojoValuePlan } from "./value-plan.js";
import { withMojoValue } from "./value-plan.js";

export function planMojoIntrinsicExpression(
  node: Node,
  context: MojoPlanningContext,
  planValue: (node: Node, context: MojoPlanningContext) => MojoValuePlan | undefined,
): MojoValuePlan | undefined {
  const selection = context.program.queries.intrinsicExpressionSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_SEALED_INTRINSIC_EXPRESSION_PLAN_MISSING",
      `Intrinsic expression '${context.program.source.ast.kindName(node)}' reached planning without a sealed operation.`,
      node,
    );
    return undefined;
  }
  const operand = planValue(selection.operand, context);
  if (operand === undefined) return undefined;
  const operandType = context.program.queries.expressionType(selection.operand);
  if (operandType === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_SEALED_INTRINSIC_OPERAND_PLAN_MISSING",
      "A sealed intrinsic operation reached planning without its operand carrier.",
      selection.operand,
    );
    return undefined;
  }
  const effect: MojoStatement = operandType.kind === "unit"
    ? Object.freeze({ kind: "expression", expression: operand.value })
    : Object.freeze({ kind: "discard", expression: operand.value });
  if (selection.kind === "typeof") {
    return withMojoValue(
      Object.freeze([...operand.before, effect]),
      Object.freeze({ kind: "string-literal", value: selection.result }),
    );
  }
  registerMojoTypeImports(selection.resultType, context);
  return withMojoValue(
    Object.freeze([...operand.before, effect]),
    Object.freeze({ kind: "construct", type: selection.resultType, arguments: Object.freeze([]) }),
  );
}
