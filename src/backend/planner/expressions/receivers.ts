import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoNullableReceiverView } from "../../../analysis/representations/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { allocateMojoSyntheticName } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { applyValueRefinement } from "./leaves.js";
import { isStableMojoLocation, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import type { MojoValuePlanner } from "./support.js";

export type PreparedMojoReceiver =
  | { readonly kind: "required"; readonly plan: MojoValuePlan; readonly type: MojoTargetTypeRef }
  | {
      readonly kind: "optional";
      readonly type: MojoTargetTypeRef;
      readonly before: readonly MojoStatement[];
      readonly condition: MojoExpression;
      readonly plan: MojoValuePlan;
    };

export function prepareMojoReceiver(
  expression: Node,
  optionalChain: boolean,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PreparedMojoReceiver | undefined {
  const receiver = planValue(expression, context);
  if (receiver === undefined) return undefined;
  const catalog = context.program.representations;
  const carrier = catalog.expressionCarrier(expression);
  const physicalType = carrier === undefined ? undefined : catalog.carrier(carrier)?.type;
  if (physicalType === undefined) throw new Error("A sealed receiver expression has no physical carrier.");
  const projection = optionalChain ? catalog.nullableReceiver(expression) : undefined;
  if (projection === undefined) return Object.freeze({ kind: "required", plan: receiver, type: physicalType });
  if (projection.carrier !== carrier) throw new Error("A nullable receiver projection changed its physical carrier.");
  registerMojoTypeImports(physicalType, context);
  const receiverName = allocateMojoSyntheticName(context, "optional_receiver");
  const receiverPath: MojoExpression = Object.freeze({ kind: "path", path: receiverName });
  const explicitCopy = context.program.lifecycle.capabilities(physicalType).copy === "explicit";
  const { present, condition } = planNullableProjection(receiverPath, projection, context);
  const valueName = explicitCopy ? allocateMojoSyntheticName(context, "optional_value") : undefined;
  return Object.freeze({
    kind: "optional",
    type: projection.value.type,
    before: Object.freeze([
      ...receiver.before,
      Object.freeze({
        kind: "variable", name: receiverName, type: physicalType,
        initializer: explicitCopy && isStableMojoLocation(receiver.value)
          ? Object.freeze({ kind: "copy", expression: receiver.value }) : receiver.value,
      }),
    ]),
    condition,
    plan: valueName === undefined ? mojoValue(present) : withMojoValue([Object.freeze({
      kind: "variable", name: valueName, reference: true, initializer: present,
    })], Object.freeze({ kind: "path", path: valueName })),
  });
}

function planNullableProjection(
  receiver: MojoExpression,
  projection: MojoNullableReceiverView,
  context: MojoPlanningContext,
): { readonly present: MojoExpression; readonly condition: MojoExpression } {
  if (projection.kind === "optional") {
    const value = Object.freeze<MojoExpression>({
      kind: "method-call", receiver, name: "value", arguments: Object.freeze([]),
    });
    if (projection.nested === undefined) return Object.freeze({ present: value, condition: receiver });
    const nested = planNullableProjection(value, projection.nested, context);
    return Object.freeze({
      present: nested.present,
      condition: Object.freeze({ kind: "binary", operator: "and", left: receiver, right: nested.condition }),
    });
  }
  const present = applyValueRefinement(receiver, projection.present, context);
  if (present === undefined) throw new Error("A sealed nullable receiver lost its present-value projection.");
  const condition = projection.absent.map(({ type }): MojoExpression => {
    registerMojoTypeImports(type, context);
    return Object.freeze({
      kind: "unary", operator: "not", operand: Object.freeze({
        kind: "method-call", receiver, name: "isa",
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type })]),
        arguments: Object.freeze([]),
      }),
    });
  }).reduce((left, right) => Object.freeze({ kind: "binary", operator: "and", left, right }));
  return Object.freeze({ present, condition });
}
