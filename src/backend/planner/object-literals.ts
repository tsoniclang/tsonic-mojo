import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoExpression, MojoStatement } from "../target-ast/nodes.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import type { MojoValuePlanner } from "./expression-support.js";
import { registerMojoTypeImports } from "./types/render.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoProjectObjectLiteral(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.objectLiteralSelection(node);
  if (selection === undefined) return undefined;
  registerMojoTypeImports(selection.targetType, context);
  const before: MojoStatement[] = [];
  const values = new Map<Node, MojoExpression>();
  for (const contribution of selection.contributions) {
    if (contribution.kind === "field") {
      const plan = planValue(contribution.value, context, contribution.fieldType);
      if (plan === undefined) return undefined;
      before.push(...plan.before);
      values.set(
        contribution.field.declaration,
        stabilize(plan.value, contribution.fieldType, "object_field", before, context),
      );
      continue;
    }
    const plan = planValue(contribution.value, context, contribution.sourceType);
    if (plan === undefined) return undefined;
    before.push(...plan.before);
    const spread = stabilize(plan.value, contribution.sourceType, "object_spread", before, context);
    for (const entry of contribution.fields) {
      const value: MojoExpression = Object.freeze({
        kind: "member",
        receiver: Object.freeze({
          kind: "postfix-deref",
          expression: Object.freeze({ kind: "member", receiver: spread, name: "_state" }),
        }),
        name: entry.field.name,
      });
      values.set(
        entry.field.declaration,
        stabilize(value, entry.fieldType, "spread_field", before, context),
      );
    }
  }
  const arguments_ = selection.fields.map(({ field, fieldType }) => {
    const value = values.get(field.declaration);
    if (value !== undefined) return Object.freeze({ value });
    if (!field.optional) return undefined;
    registerMojoTypeImports(fieldType, context);
    return Object.freeze({
      value: Object.freeze({
        kind: "construct" as const,
        type: fieldType,
        arguments: Object.freeze([]),
      }),
    });
  });
  if (arguments_.some((argument) => argument === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OBJECT_REQUIRED_FIELD_PLAN_MISSING",
      "Project object construction has no sealed value for one required interface field.",
      node,
    );
    return undefined;
  }
  return withMojoValue(before, Object.freeze({
    kind: "construct",
    type: selection.targetType,
    arguments: Object.freeze(arguments_ as { readonly value: MojoExpression }[]),
  }));
}

function stabilize(
  value: MojoExpression,
  type: MojoTargetTypeRef,
  role: string,
  before: MojoStatement[],
  context: MojoPlanningContext,
): MojoExpression {
  registerMojoTypeImports(type, context);
  const name = allocateMojoSyntheticName(context, role);
  before.push(Object.freeze({ kind: "variable", name, type, initializer: value }));
  return Object.freeze({ kind: "path", path: name });
}
