import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { allocateMojoSyntheticName } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import type { MojoValuePlan } from "./value-plan.js";

export function orderMojoLocationValues(
  values: readonly { readonly plan: MojoValuePlan; readonly type: MojoTargetTypeRef; readonly role: string }[],
  context: MojoPlanningContext,
): { readonly before: readonly MojoStatement[]; readonly values: readonly MojoExpression[] } {
  const before: MojoStatement[] = [];
  const expressions: MojoExpression[] = [];
  for (const value of values) {
    const name = allocateMojoSyntheticName(context, value.role);
    registerMojoTypeImports(value.type, context);
    before.push(...value.plan.before, Object.freeze({ kind: "variable", name, type: value.type, initializer: value.plan.value }));
    expressions.push(Object.freeze({ kind: "path", path: name }));
  }
  return Object.freeze({ before: Object.freeze(before), values: Object.freeze(expressions) });
}
