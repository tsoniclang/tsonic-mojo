import type { MojoAnalyzedClass } from "../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoFunctionDeclaration } from "../../target-ast/index.js";
import { planMojoValue } from "../expressions/value.js";
import { consumeMojoValue } from "../expressions/value-plan.js";
import { withMojoErrorType, withMojoLocalNameScope } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoConstructionFactory } from "./construction-factories.js";
import { planMojoParameterDeclaration, planMojoParameterPrelude } from "./parameters.js";

export function planMojoProjectConstructorFactory(
  class_: MojoAnalyzedClass,
  adapter: import("../../../analysis/program/model.js").MojoCallableImplementationAdapter,
  genericParameters: MojoFunctionDeclaration["genericParameters"],
  stateType: MojoTargetTypeRef,
  storageType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.kind !== "constructor-overload") return undefined;
  const constructorContext = withMojoErrorType(
    withMojoLocalNameScope(context),
    adapter.errorType,
  );
  const parameterPrelude = planMojoParameterPrelude(
    adapter.contract.parameters,
    constructorContext,
    planMojoValue,
    true,
  );
  if (parameterPrelude === undefined) return undefined;
  const arguments_ = adapter.contract.parameters.map((parameter) => {
    const value = Object.freeze({ kind: "path" as const, path: parameter.incomingName });
    const inputType = parameter.omissionKind === "rest" ? parameter.type : parameter.callType;
    return Object.freeze({
      value: mojoParameterConvention(parameter.disposition) === "var"
        ? consumeMojoValue(value, inputType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    });
  });
  const state = Object.freeze({
    kind: "construct" as const,
    type: stateType,
    arguments: Object.freeze(arguments_),
  });
  const storage = Object.freeze({
    kind: "construct" as const,
    type: storageType,
    arguments: Object.freeze([Object.freeze({ value: state })]),
  });
  return mojoConstructionFactory({
    name: class_.constructorFactoryName,
    genericParameters,
    parameters: Object.freeze(adapter.contract.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, constructorContext))),
    resultType: class_.targetType,
    raises: adapter.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    statements: parameterPrelude,
    result: Object.freeze({
      kind: "construct",
      type: class_.targetType,
      arguments: Object.freeze([Object.freeze({ value: storage })]),
    }),
  });
}

export function planMojoProjectConstructorForwarder(
  adapter: import("../../../analysis/program/model.js").MojoCallableImplementationAdapter,
  stateType: MojoTargetTypeRef,
  storageType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const constructorContext = withMojoErrorType(
    withMojoLocalNameScope(context),
    adapter.errorType,
  );
  const parameterPrelude = planMojoParameterPrelude(
    adapter.contract.parameters,
    constructorContext,
    planMojoValue,
    true,
  );
  if (parameterPrelude === undefined) return undefined;
  const arguments_ = adapter.contract.parameters.map((parameter) => {
    const value = Object.freeze({ kind: "path" as const, path: parameter.incomingName });
    const inputType = parameter.omissionKind === "rest" ? parameter.type : parameter.callType;
    return Object.freeze({
      value: mojoParameterConvention(parameter.disposition) === "var"
        ? consumeMojoValue(value, inputType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    });
  });
  return Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(adapter.contract.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, constructorContext))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: adapter.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    self: "out self",
    statements: Object.freeze([
      ...parameterPrelude,
      Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: "self" }),
          name: "_state",
        }),
        right: Object.freeze({
          kind: "construct",
          type: storageType,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({
              kind: "construct",
              type: stateType,
              arguments: Object.freeze(arguments_),
            }),
          })]),
        }),
      }),
    ]),
  });
}
