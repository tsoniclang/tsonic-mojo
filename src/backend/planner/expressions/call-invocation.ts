import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "../../../analysis/program/call-model.js";
import { closeMojoErrorType, mojoOperationErrorTypes } from "../../../target-model/types/error-domains.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import { mojoTargetTypeInContext } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { orderCallArguments } from "./call-support.js";
import { adaptMojoValueErrorDomain } from "./error-domains.js";
import { convertMojoValue } from "./support.js";
import type { OrderedMojoValue, PlannedMojoCallArgument } from "./support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function createMojoCallInvocationPlanner(
  selection: Extract<MojoCallSelection, { readonly kind: "project" | "provider" | "callable" }>,
  node: Node,
  context: MojoPlanningContext,
) {
  const selectedErrorType = selection.kind === "project"
    ? selection.invocationErrorType
    : closeMojoErrorType(mojoOperationErrorTypes(selection.kind === "provider"
        ? selection.operation
        : selection.callableType));
  const errorType = selectedErrorType === undefined
    ? undefined
    : mojoTargetTypeInContext(selectedErrorType, context);
  const isolateInvocation = errorType?.kind === "union" &&
    (context.errorType === undefined || !mojoTargetTypeEquals(errorType, context.errorType));
  return Object.freeze({
    orderArguments(arguments_: readonly PlannedMojoCallArgument[], receiver?: OrderedMojoValue) {
      return orderCallArguments(arguments_, context, receiver, isolateInvocation);
    },
    convertResult(plan: MojoValuePlan): MojoValuePlan | undefined {
      if (!isolateInvocation) return convertMojoValue(plan, selection.resultConversion, context);
      const resultType = mojoTargetTypeInContext(selection.kind === "provider"
        ? selection.operation.resultType
        : selection.kind === "callable" ? selection.callableType.result : selection.resultType, context);
      const adapted = adaptMojoValueErrorDomain(
        mojoValue(plan.value),
        resultType,
        errorType,
        context.errorType,
        node,
        context,
      );
      return adapted === undefined ? undefined : convertMojoValue(
        withMojoValue([...plan.before, ...adapted.before], adapted.value),
        selection.resultConversion,
        context,
      );
    },
  });
}
