import type { MojoIterationSelection } from "../../../analysis/program/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoValuePlan } from "../expressions/value-plan.js";
import { allocateMojoSyntheticName, mojoTargetTypeInContext } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function planMojoLiveArrayIteration(
  selection: MojoIterationSelection,
  iterable: MojoValuePlan,
  statements: readonly MojoStatement[],
  context: MojoPlanningContext,
): readonly MojoStatement[] {
  const arrayName = allocateMojoSyntheticName(context, "iterable");
  const indexName = allocateMojoSyntheticName(context, "index");
  const array: MojoExpression = Object.freeze({ kind: "path", path: arrayName });
  const index: MojoExpression = Object.freeze({ kind: "path", path: indexName });
  const elementType = mojoTargetTypeInContext(selection.elementType, context);
  registerMojoTypeImports(elementType, context);
  return Object.freeze([
    ...iterable.before,
    Object.freeze({ kind: "variable", name: arrayName, initializer: iterable.value }),
    Object.freeze({
      kind: "variable", name: indexName,
      initializer: Object.freeze({ kind: "number-literal", text: "0" }),
    }),
    Object.freeze({
      kind: "while",
      condition: Object.freeze({
        kind: "binary", operator: "<", left: index,
        right: Object.freeze({
          kind: "call", callee: Object.freeze({ kind: "path", path: "len" }),
          arguments: Object.freeze([Object.freeze({ value: array })]),
        }),
      }),
      statements: Object.freeze([
        Object.freeze({
          kind: "variable", name: selection.binding.name, type: elementType,
          initializer: Object.freeze({
            kind: "method-call", receiver: array, name: "read_value",
            arguments: Object.freeze([Object.freeze({ value: index })]),
          }),
        }),
        Object.freeze({
          kind: "assignment", operator: "+=", left: index,
          right: Object.freeze({ kind: "number-literal", text: "1" }),
        }),
        ...statements,
      ]),
    }),
  ]);
}
