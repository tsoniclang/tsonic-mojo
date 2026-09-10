import type { MojoPropertySelection } from "../../../analysis/program/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { allocateMojoSyntheticName } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { convertMojoValue, orderMojoValues, prepareMojoReceiver } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoProviderUnionProperty(
  selection: Extract<MojoPropertySelection, { readonly kind: "provider-union-property" }>,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const receiver = prepareMojoReceiver(
    selection.receiver, selection.receiverType, false, context, planValue,
  );
  if (receiver === undefined) return undefined;
  registerMojoTypeImports(selection.receiverType, context);
  registerMojoTypeImports(selection.resultType, context);
  const ordered = orderMojoValues([Object.freeze({
    plan: receiver.plan, type: selection.receiverType, role: "union_property_receiver",
  })], context, true);
  const value = ordered.values[0]!;
  const projections = selection.variants.map((variant) => {
    registerMojoTypeImports(variant.receiverType, context);
    const member: MojoExpression = Object.freeze({
      kind: "proven-union-member", receiver: value, type: variant.receiverType,
    });
    return convertMojoValue(mojoValue(Object.freeze({
      kind: "method-call", receiver: member, name: variant.readName,
      arguments: Object.freeze([]),
    })), variant.readConversion, context);
  });
  if (projections.length === 0 || projections.some((projection) => projection === undefined)) {
    return undefined;
  }
  const resultName = allocateMojoSyntheticName(context, "union_property_value");
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const branch = (index: number): readonly MojoStatement[] => {
    const projection = projections[index]!;
    const statements: readonly MojoStatement[] = Object.freeze([
      ...projection.before,
      Object.freeze({ kind: "assignment", operator: "=", left: result, right: projection.value }),
    ]);
    if (index === projections.length - 1) return statements;
    return Object.freeze([Object.freeze({
      kind: "if",
      condition: Object.freeze({
        kind: "method-call", receiver: value, name: "isa",
        genericArguments: Object.freeze([Object.freeze({
          kind: "type", type: selection.variants[index]!.receiverType,
        })]),
        arguments: Object.freeze([]),
      }),
      thenStatements: statements,
      elseStatements: branch(index + 1),
    })]);
  };
  return withMojoValue([
    ...ordered.before,
    Object.freeze({ kind: "variable", name: resultName, type: selection.resultType }),
    ...branch(0),
  ], result);
}
