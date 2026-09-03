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
  return lifecycle.capabilities(type).registerPassing === "trivial"
    ? value
    : Object.freeze({ kind: "consume", expression: value });
}

export function mapMojoValue(
  plan: MojoValuePlan,
  map: (value: MojoExpression) => MojoExpression | undefined,
): MojoValuePlan | undefined {
  const value = map(plan.value);
  return value === undefined ? undefined : withMojoValue(plan.before, value);
}
