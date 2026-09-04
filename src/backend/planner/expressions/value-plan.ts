import type { MojoLifecycleResolver } from "../../../analysis/lifecycle/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";

export interface MojoValuePlan {
  readonly before: readonly MojoStatement[];
  readonly value: MojoExpression;
}

export function mojoValue(value: MojoExpression): MojoValuePlan {
  return Object.freeze({ before: Object.freeze([]), value });
}

export function withMojoValue(
  before: readonly MojoStatement[],
  value: MojoExpression,
): MojoValuePlan {
  return Object.freeze({ before: Object.freeze([...before]), value });
}

export function consumeMojoValue(
  value: MojoExpression,
  type: MojoTargetTypeRef,
  lifecycle: MojoLifecycleResolver,
): MojoExpression {
  return lifecycle.capabilities(type).registerPassing === "trivial" ||
    !isMojoPlaceExpression(value)
    ? value
    : Object.freeze({ kind: "consume", expression: value });
}

function isMojoPlaceExpression(value: MojoExpression): boolean {
  switch (value.kind) {
    case "path":
    case "member":
    case "element":
    case "type-element":
    case "postfix-deref":
      return true;
    case "parenthesized":
      return isMojoPlaceExpression(value.expression);
    case "qualified-path":
    case "type-value":
    case "string-literal":
    case "number-literal":
    case "bool-literal":
    case "none-literal":
    case "tuple":
    case "list":
    case "dictionary":
    case "unary":
    case "binary":
    case "conditional":
    case "call":
    case "method-call":
    case "slice":
    case "construct":
    case "forced-comptime":
    case "generic-argument-value":
    case "copy":
    case "materialize":
    case "consume":
    case "await":
    case "lambda":
      return false;
  }
}

export function mapMojoValue(
  plan: MojoValuePlan,
  map: (value: MojoExpression) => MojoExpression | undefined,
): MojoValuePlan | undefined {
  const value = map(plan.value);
  return value === undefined ? undefined : withMojoValue(plan.before, value);
}
