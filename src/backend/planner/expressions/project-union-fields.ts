import type { Node } from "@tsonic/tsts";
import type { MojoPropertySelection } from "../../../analysis/operations/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { appendMojoPlanningDiagnostic } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { mojoStateValue } from "../declarations/state-storage.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { prepareMojoPropertyReceiver } from "./property-receivers.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoCompoundValue } from "./numeric.js";
import { prepareMojoMutationValue } from "./mutation-plan.js";
import type { MojoPreparedMutation } from "./mutation-plan.js";

type UnionFields = Extract<MojoPropertySelection, { readonly kind: "project-union-field" }>;

function prepareFields(
  node: Node,
  selection: UnionFields,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
) {
  const receiver = prepareMojoPropertyReceiver(
    selection, selection.receiver, selection.receiverType, false, context, planValue,
  );
  if (receiver === undefined) return undefined;
  registerMojoTypeImports(selection.receiverType, context);
  registerMojoTypeImports(selection.resultType, context);
  const ordered = orderMojoValues([Object.freeze({
    plan: receiver.plan, type: selection.receiverType, role: "union_property_receiver",
    use: "snapshot",
  })], context, true);
  const value = ordered.values[0]!;
  const fields = selection.fields.map((field) => {
    const state = context.program.queries.projectState(field.receiverType);
    if (state === undefined) return undefined;
    registerMojoTypeImports(field.receiverType, context);
    registerMojoTypeImports(state.stateType, context);
    const location: MojoExpression = Object.freeze({
      kind: "member",
      receiver: mojoStateValue(Object.freeze({ kind: "proven-union-member", receiver: value, type: field.receiverType }), state),
      name: field.fieldName,
    });
    const condition: MojoExpression = Object.freeze({
      kind: "method-call", receiver: value, name: "isa",
      genericArguments: Object.freeze([Object.freeze({ kind: "type", type: field.receiverType })]),
      arguments: Object.freeze([]),
    });
    return Object.freeze({ location, condition });
  });
  if (fields.length === 0 || fields.some((field) => field === undefined)) {
    appendMojoPlanningDiagnostic(context, "MOJO_PROJECT_UNION_STATE_NOT_SEALED",
      "A project-union property requires every exact sealed state projection.", node);
    return undefined;
  }
  const selected = fields as readonly NonNullable<(typeof fields)[number]>[];
  let read: MojoExpression = selected[selected.length - 1]!.location;
  for (let index = selected.length - 2; index >= 0; index--) {
    read = Object.freeze({ kind: "conditional", condition: selected[index]!.condition,
      whenTrue: selected[index]!.location, whenFalse: read });
  }
  return Object.freeze({ before: ordered.before, fields: selected, read });
}

export function planMojoProjectUnionRead(
  node: Node,
  selection: UnionFields,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const prepared = prepareFields(node, selection, context, planValue);
  return prepared === undefined ? undefined : withMojoValue(prepared.before, prepared.read);
}

export function planMojoProjectUnionWrite(
  node: Node,
  selection: UnionFields,
  right: MojoValuePlan,
  operator: string,
  operationNode: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoPreparedMutation | undefined {
  const prepared = prepareFields(node, selection, context, planValue);
  if (prepared === undefined) return undefined;
  const previous = operator === "=" ? undefined : orderMojoValues([Object.freeze({
    plan: mojoValue(prepared.read), type: selection.resultType, role: "union_property_previous",
  })], context, true);
  const previousValue = previous?.values[0];
  const assignedValue = previousValue === undefined ? right.value
    : planMojoCompoundValue(operationNode, operator, previousValue, right.value, context);
  return Object.freeze({
    before: Object.freeze([...prepared.before, ...(previous?.before ?? []), ...right.before]),
    assignedValue,
    ...prepareMojoMutationValue(operationNode, selection.resultType, context),
    ...(previousValue === undefined ? {} : { previousValue }),
    valuePassing: "assign",
    createWrite(value: MojoExpression): MojoStatement {
      const branch = (index: number): MojoStatement => {
        const field = prepared.fields[index]!;
        const write: MojoStatement = Object.freeze({ kind: "assignment", operator: "=", left: field.location, right: value });
        return index === prepared.fields.length - 1 ? write : Object.freeze({
          kind: "if", condition: field.condition,
          thenStatements: Object.freeze([write]), elseStatements: Object.freeze([branch(index + 1)]),
        });
      };
      return branch(0);
    },
  });
}
