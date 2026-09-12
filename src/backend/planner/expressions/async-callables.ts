import type { MojoCallableExpressionSelection } from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import { mojoNativeErrorType } from "../../../target-model/types/error-domains.js";
import type { MojoExpression, MojoFunctionDeclaration } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";

const runtimeModule = Object.freeze(["tsonic_runtime"]);

export function planMojoAsyncCallableValue(
  selection: MojoCallableExpressionSelection,
  targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  environmentName: string,
  ownerName: string,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const result = selection.callableType.result;
  if (result.kind !== "future" || result.domain !== "native" ||
    result.captureOrigins !== "empty" || !result.raises ||
    !mojoTargetTypeEquals(result, targetType.result)) {
    appendMojoPlanningDiagnostic(context,
      "MOJO_ASYNC_CALLABLE_RESULT_CONTRACT_MISMATCH",
      "An async callable requires its sealed closed native future result and an explicit outer result adapter.",
      selection.expression);
    return undefined;
  }
  const argumentType: MojoTargetTypeRef = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(targetType.parameters.map((parameter) => parameter.type)),
  });
  const callable: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, runtimeModule, "make_async_callable"),
    genericArguments: Object.freeze([
      Object.freeze({ kind: "type", type: argumentType }),
      Object.freeze({ kind: "type", type: result.output }),
    ]),
    arguments: Object.freeze([
      Object.freeze({ value: Object.freeze({ kind: "path", path: ownerName }) }),
      Object.freeze({ value: Object.freeze({
        kind: "member",
        receiver: Object.freeze({ kind: "path", path: environmentName }),
        name: "start",
      }) }),
    ]),
  });
  return !targetType.raises ? callable : Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, runtimeModule, "widen_callable"),
    genericArguments: Object.freeze([
      Object.freeze({ kind: "type", type: argumentType }),
      Object.freeze({ kind: "type", type: result }),
      Object.freeze({ kind: "type", type: targetType.errorType ?? mojoNativeErrorType() }),
    ]),
    arguments: Object.freeze([Object.freeze({ value: callable })]),
  });
}

export function planMojoAsyncCallableMethods(
  invoke: MojoFunctionDeclaration,
  futureType: MojoTargetTypeRef,
  environmentName: string,
  ownerName: string,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] {
  const contextParameter = invoke.parameters[0]!;
  const argumentParameter = invoke.parameters[1]!;
  const contextValue: MojoExpression = Object.freeze({ kind: "path", path: contextParameter.name });
  const { errorType: _bodyError, ...factory } = invoke;
  const start: MojoFunctionDeclaration = Object.freeze({
    ...factory,
    name: "start",
    parameters: Object.freeze([contextParameter]),
    resultType: futureType,
    raises: false,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "call",
        callee: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: environmentName }),
          name: "execute",
        }),
        arguments: Object.freeze([Object.freeze({ value: contextValue })]),
      }),
    })]),
  });
  const execute: MojoFunctionDeclaration = Object.freeze({
    ...invoke,
    name: "execute",
    parameters: Object.freeze([contextParameter]),
    asynchronous: true,
    raises: true,
    statements: Object.freeze([
      Object.freeze({
        kind: "variable",
        name: ownerName,
        initializer: Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(context, runtimeModule, "take_async_invocation"),
          genericArguments: Object.freeze([Object.freeze({ kind: "type", type: argumentParameter.type })]),
          arguments: Object.freeze([Object.freeze({ value: contextValue })]),
        }),
      }),
      Object.freeze({
        kind: "variable",
        name: argumentParameter.name,
        reference: true,
        initializer: Object.freeze({
          kind: "element",
          receiver: Object.freeze({ kind: "path", path: ownerName }),
          index: Object.freeze({ kind: "number-literal", text: "1" }),
        }),
      }),
      Object.freeze({
        kind: "try",
        statements: invoke.statements ?? Object.freeze([]),
        catches: Object.freeze([]),
        finallyStatements: Object.freeze([Object.freeze({
          kind: "discard",
          expression: Object.freeze({ kind: "path", path: ownerName }),
        })]),
      }),
    ]),
  });
  return Object.freeze([start, execute]);
}
