import type { MojoJsValueAccessor } from "../../../../target-model/conversions/js-value-graph.js";
import { mojoNativeErrorType } from "../../../../target-model/types/error-domains.js";
import type { MojoExpression, MojoStatement } from "../../../target-ast/index.js";
import { withMojoErrorType } from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { adaptMojoValueErrorDomain } from "../error-domains.js";
import { mojoValue } from "../value-plan.js";
import type { SourceValueReader } from "./adapters.js";
import { method, returned } from "./syntax.js";

export function planSourceValueMethod(
  selected: Omit<MojoJsValueAccessor, "sourceName">,
  receiver: MojoExpression,
  arguments_: readonly MojoExpression[],
  context: MojoPlanningContext,
  read: SourceValueReader,
): readonly MojoStatement[] | undefined {
  const implementation = context.program.queries.callableImplementation(selected.declaration);
  if (implementation === undefined) throw new Error("A sealed source-value method lost its exact implementation.");
  const raisingContext = withMojoErrorType(context, mojoNativeErrorType());
  const invocation = adaptMojoValueErrorDomain(
    mojoValue(method(receiver, selected.name, arguments_)), selected.resultType,
    implementation.raises ? implementation.errorType ?? mojoNativeErrorType() : undefined,
    mojoNativeErrorType(), selected.declaration, raisingContext,
  );
  if (invocation === undefined) return undefined;
  const converted = read(selected.resultProjection, invocation.value, raisingContext);
  return converted === undefined ? undefined : Object.freeze([...invocation.before, ...converted.before, returned(converted.value)]);
}
