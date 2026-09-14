import type { MojoSelectedProviderOperation } from "../../../target-model/operations/selection.js";
import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { convertMojoValue } from "./support.js";
import { mojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planProviderConstant(
  operation: MojoSelectedProviderOperation,
  resultConversion: MojoValueConversion,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (operation.target.kind !== "constant" && operation.target.kind !== "function-read") return undefined;
  const selected: MojoExpression = operation.target.kind === "constant"
    ? mojoModuleMemberExpression(context, operation.target.modulePath, operation.target.name)
    : {
        kind: "call",
        callee: mojoModuleMemberExpression(context, operation.target.modulePath, operation.target.name),
        arguments: Object.freeze([]),
      };
  return convertMojoValue(mojoValue(selected), resultConversion, context);
}
