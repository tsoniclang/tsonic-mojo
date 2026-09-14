import type { Node } from "@tsonic/tsts";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPreparedMutation } from "./mutation-plan.js";
import { prepareMojoMutationValue } from "./mutation-plan.js";
import { mojoCompoundRightType, planMojoCompoundValue } from "./numeric.js";
import { planMojoProperty } from "./properties.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoStaticProviderWrite(
  location: Node,
  right: MojoValuePlan,
  operator: string,
  operation: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoPreparedMutation | undefined {
  const selection = context.program.queries.propertySelection(location);
  if (selection?.kind !== "provider-static") return undefined;
  const write = selection.writeOperation;
  if (write?.target.kind !== "function-write" || write.parameterTypes.length !== 1 ||
    write.resultType.kind !== "unit" || selection.sourceWriteType === undefined ||
    selection.writeValueConversion === undefined) {
    throw new Error("A sealed static mutation requires one source and target write operation.");
  }
  const target = write.target;
  const mutationValue = prepareMojoMutationValue(
    operation, selection.sourceWriteType, context, selection.writeValueConversion,
  );
  let before = right.before;
  let assigned = right.value;
  let previousValue: MojoExpression | undefined;
  if (operator !== "=") {
    const current = planMojoProperty(location, context, planValue, "read");
    const readType = context.program.queries.expressionType(location);
    if (current === undefined || readType === undefined) return undefined;
    const ordered = orderMojoValues([
      Object.freeze({ plan: current, type: readType, role: "static_property_read" }),
      Object.freeze({
        plan: right,
        type: mojoCompoundRightType(operation, mutationValue.assignedType, context),
        role: "static_property_right",
      }),
    ], context, true);
    before = ordered.before;
    previousValue = ordered.values[0]!;
    assigned = planMojoCompoundValue(operation, operator, previousValue, ordered.values[1]!, context);
  }
  return Object.freeze({
    before,
    assignedValue: assigned,
    ...mutationValue,
    ...(previousValue === undefined ? {} : { previousValue }),
    valuePassing: target.value.convention === "var" ? "consume" : "borrow",
    createWrite(value: MojoExpression): MojoStatement {
      return Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(context, target.modulePath, target.name),
          arguments: Object.freeze([Object.freeze({
            value: target.value.convention === "var"
              ? consumeMojoValue(value, write.parameterTypes[0]!, context.program.lifecycle)
              : value,
            ...(target.value.position === "keyword" ? { name: target.value.nativeName! } : {}),
          })]),
        }),
      });
    },
  });
}
