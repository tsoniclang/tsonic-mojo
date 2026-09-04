import type { MojoCallableImplementationAdapter } from "../../../analysis/program/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStatement,
} from "../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../target-ast/index.js";
import {
  mojoTargetGenericArgumentsInContext,
  withMojoErrorType,
  withMojoLocalNameScope,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { convertMojoValue } from "../expressions/support.js";
import { mojoValue } from "../expressions/value-plan.js";
import { planMojoGenericParameters } from "../declarations/generic-parameters.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "../declarations/parameters.js";
import { planMojoCallableAdapterArguments } from "./parameter-adapters.js";
import { planMojoValue } from "../expressions/value.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";

export function planMojoTopLevelImplementationAdapter(
  adapter: MojoCallableImplementationAdapter,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.kind !== "top-level-function-overload") return undefined;
  return planCallableAdapter(adapter, context, Object.freeze({
    kind: "call",
    callee: Object.freeze({ kind: "path", path: adapter.implementation.name }),
  }));
}

export function planMojoMemberImplementationAdapter(
  adapter: MojoCallableImplementationAdapter,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.kind !== "instance-method-overload" &&
    adapter.kind !== "static-method-overload") return undefined;
  const ownerType = adapter.implementation.owner?.type;
  if (ownerType === undefined) return undefined;
  const implementationName = adapter.kind === "instance-method-overload"
    ? context.program.projectDispatch.implementationName(
        adapter.implementation.declaration,
        adapter.targetGenericArguments,
      ) ?? adapter.implementation.name
    : adapter.implementation.name;
  const declaration = planCallableAdapter(adapter, context, Object.freeze({
    kind: "method-call",
    receiver: adapter.kind === "instance-method-overload"
      ? Object.freeze({ kind: "path", path: "self" })
      : Object.freeze({ kind: "type-value", type: ownerType }),
    name: implementationName,
  }));
  if (declaration === undefined) return undefined;
  return Object.freeze({
    ...declaration,
    ...(adapter.kind === "instance-method-overload"
      ? { self: "self" as const }
      : { decorators: mojoStaticMethodDecorators }),
  });
}

export function planMojoConstructorImplementationAdapter(
  adapter: MojoCallableImplementationAdapter,
  targetType: import("../../../target-model/types/model.js").MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.kind !== "constructor-overload") return undefined;
  const adapterContext = withMojoErrorType(
    withMojoLocalNameScope(context),
    adapter.errorType,
  );
  registerMojoTypeImports(targetType, adapterContext);
  const parameterPrelude = planMojoParameterPrelude(
    adapter.contract.parameters,
    adapterContext,
    planMojoValue,
    true,
  );
  const adapted = planMojoCallableAdapterArguments(adapter.parameterAdapters, adapterContext);
  if (parameterPrelude === undefined || adapted === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(adapter.contract.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, adapterContext))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: adapter.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    self: "out self",
    statements: Object.freeze([
      ...parameterPrelude,
      ...adapted.before,
      Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({ kind: "path", path: "self" }),
        right: Object.freeze({
          kind: "construct",
          type: targetType,
          arguments: adapted.arguments,
        }),
      }),
    ]),
  });
}

export function constructorAdapterRequiresDeclaration(
  adapter: MojoCallableImplementationAdapter,
): boolean {
  if (adapter.kind !== "constructor-overload" ||
    adapter.contract.parameters.length !== adapter.targetParameters.length ||
    adapter.parameterAdapters.length !== adapter.targetParameters.length ||
    adapter.targetGenericArguments.length !== 0) return true;
  return adapter.parameterAdapters.some((parameterAdapter, index) => {
    if (parameterAdapter.kind !== "value" || parameterAdapter.sourceIndex !== index ||
      parameterAdapter.conversion.kind !== "identity") return true;
    const target = adapter.targetParameters[index];
    return target === undefined ||
      parameterAdapter.source.omissionKind !== target.omissionKind ||
      mojoParameterConvention(parameterAdapter.source.disposition) !==
        mojoParameterConvention(target.disposition) ||
      !mojoTargetTypeEquals(parameterAdapter.source.callType, target.callType);
  });
}

function planCallableAdapter(
  adapter: MojoCallableImplementationAdapter,
  context: MojoPlanningContext,
  target: Readonly<
    | { readonly kind: "call"; readonly callee: MojoExpression }
    | {
        readonly kind: "method-call";
        readonly receiver: MojoExpression;
        readonly name: string;
      }
  >,
): MojoFunctionDeclaration | undefined {
  const adapterContext = withMojoErrorType(
    withMojoLocalNameScope(context),
    adapter.errorType,
  );
  registerMojoTypeImports(adapter.contract.resultType, adapterContext);
  registerMojoTypeImports(adapter.implementationResultType, adapterContext);
  if (adapter.errorType !== undefined) registerMojoTypeImports(adapter.errorType, adapterContext);
  const parameterPrelude = planMojoParameterPrelude(
    adapter.contract.parameters,
    adapterContext,
    planMojoValue,
    true,
  );
  const adapted = planMojoCallableAdapterArguments(adapter.parameterAdapters, adapterContext);
  if (parameterPrelude === undefined || adapted === undefined) return undefined;
  const targetGenericArguments = mojoTargetGenericArgumentsInContext(
    adapter.targetGenericArguments,
    adapterContext,
  );
  let call: MojoExpression = target.kind === "call"
    ? Object.freeze({
        kind: "call",
        callee: target.callee,
        ...(targetGenericArguments.length === 0 ? {} : { genericArguments: targetGenericArguments }),
        arguments: adapted.arguments,
      })
    : Object.freeze({
        kind: "method-call",
        receiver: target.receiver,
        name: target.name,
        ...(targetGenericArguments.length === 0 ? {} : { genericArguments: targetGenericArguments }),
        arguments: adapted.arguments,
      });
  if (adapter.implementation.asynchronous) {
    call = Object.freeze({ kind: "await", expression: call });
  }
  const converted = convertMojoValue(
    mojoValue(call),
    adapter.resultConversion,
    adapterContext,
  );
  if (converted === undefined) return undefined;
  const completion: MojoStatement = adapter.contract.resultType.kind === "unit"
    ? Object.freeze({ kind: "expression", expression: converted.value })
    : Object.freeze({ kind: "return", expression: converted.value });
  return Object.freeze({
    kind: "function",
    name: adapter.name,
    genericParameters: planMojoGenericParameters(adapter.contract),
    parameters: Object.freeze(adapter.contract.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, adapterContext))),
    resultType: adapter.contract.resultType,
    asynchronous: adapter.contract.asynchronous,
    raises: adapter.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    statements: Object.freeze([
      ...parameterPrelude,
      ...adapted.before,
      ...converted.before,
      completion,
    ]),
  });
}
