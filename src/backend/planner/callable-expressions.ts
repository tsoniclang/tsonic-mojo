import type { Node } from "@tsonic/tsts";
import type { MojoParameter } from "../target-ast/nodes.js";
import { appendMojoPlanningDiagnostic } from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import type { MojoValuePlanner } from "./expression-support.js";
import { registerMojoTypeImports } from "./types/render.js";
import { mojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoCallableExpression(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.callableExpressionSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_CALLABLE_EXPRESSION_PLAN_MISSING",
      "Callable expression has no sealed Mojo lambda selection.",
      node,
    );
    return undefined;
  }
  const parameters: MojoParameter[] = [];
  for (const parameter of selection.parameters) {
    registerMojoTypeImports(parameter.type, context);
    const initializerNode = parameter.initializer;
    const initializer = initializerNode === undefined
      ? undefined
      : planValue(initializerNode, context, parameter.type);
    if (initializerNode !== undefined && initializer === undefined) return undefined;
    if (initializer !== undefined && initializer.before.length !== 0) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_CALLABLE_DEFAULT_EVALUATION_REGION_UNSUPPORTED",
        "A Mojo lambda default value cannot contain target evaluation-region statements.",
        initializerNode!,
      );
      return undefined;
    }
    parameters.push(Object.freeze({
      name: parameter.name,
      type: parameter.type,
      convention: parameter.convention,
      variadic: parameter.rest,
      ...(initializer !== undefined
        ? { defaultValue: initializer.value }
        : parameter.optional
          ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
          : {}),
    }));
  }
  registerMojoTypeImports(selection.resultType, context);
  const body = planValue(selection.body, context, selection.resultType);
  if (body === undefined) return undefined;
  if (body.before.length !== 0) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_CALLABLE_BODY_EVALUATION_REGION_UNSUPPORTED",
      "The pinned Mojo lambda form requires one expression body without target evaluation-region statements.",
      selection.body,
    );
    return undefined;
  }
  return mojoValue(Object.freeze({
    kind: "lambda",
    parameters: Object.freeze(parameters),
    captures: Object.freeze(selection.captures.map((capture) => Object.freeze({
      name: capture.name,
      convention: capture.convention,
    }))),
    resultType: selection.resultType,
    raises: selection.raises,
    expression: body.value,
  }));
}
