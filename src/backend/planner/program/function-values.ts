import type { MojoAnalyzedModuleBinding } from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../target-ast/index.js";
import { consumeMojoValue, withMojoValue } from "../expressions/value-plan.js";
import type { MojoValuePlan } from "../expressions/value-plan.js";
import { registerMojoTypeImports } from "../types/imports.js";
import {
  allocateMojoSyntheticDeclarationName,
  mojoModuleMemberExpression,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";

const runtimeModule = Object.freeze(["tsonic_runtime"]);
const unitType: MojoTargetTypeRef = Object.freeze({ kind: "unit" });

export function planMojoFunctionValue(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  const function_ = binding.functionValue;
  if (binding.kind !== "function-value" || function_ === undefined ||
    binding.type.kind !== "callable") return undefined;
  const callableType = binding.type;
  registerMojoTypeImports(callableType, context);
  const existingName = context.callableArtifactNames.get(binding.declaration);
  const adapterName = existingName ?? allocateMojoSyntheticDeclarationName(
    context,
    `${function_.name}_callable`,
  );
  if (existingName === undefined) {
    context.callableArtifactNames.set(binding.declaration, adapterName);
    context.syntheticDeclarations.push(functionValueAdapter(
      binding,
      adapterName,
      context,
    ));
  }
  const adapterType = localNamedType(context, adapterName);
  const environment: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      runtimeModule,
      "allocate_callable_environment",
    ),
    arguments: Object.freeze([
      Object.freeze({
        value: Object.freeze({
          kind: "construct",
          type: adapterType,
          arguments: Object.freeze([]),
        }),
      }),
      Object.freeze({
        value: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: adapterName }),
          name: "destroy",
        }),
      }),
    ]),
  });
  return withMojoValue(Object.freeze([]), Object.freeze({
    kind: "construct",
    type: callableType,
    arguments: Object.freeze([
      Object.freeze({ value: environment }),
      Object.freeze({
        value: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: adapterName }),
          name: "invoke",
        }),
      }),
    ]),
  }));
}

function functionValueAdapter(
  binding: MojoAnalyzedModuleBinding,
  name: string,
  context: MojoPlanningContext,
): MojoStructDeclaration {
  const function_ = binding.functionValue!;
  const callableType = binding.type as Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
  const adapterType = localNamedType(context, name);
  const contextType = runtimeNamedType(
    "tsonic.mojo.runtime.ErasedCallableContext",
    "ErasedCallableContext",
  );
  const argumentType: MojoTargetTypeRef = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(callableType.parameters.map((parameter) => parameter.type)),
  });
  registerMojoTypeImports(contextType, context);
  registerMojoTypeImports(argumentType, context);
  const argumentsName = `${name}_arguments`;
  const callArguments: MojoCallArgument[] = function_.parameters.map((parameter, index) => {
    const value: MojoExpression = Object.freeze({
      kind: "element",
      receiver: Object.freeze({ kind: "path", path: argumentsName }),
      index: Object.freeze({ kind: "number-literal", text: String(index) }),
    });
    return Object.freeze({
      value: parameter.disposition.kind === "owned"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    });
  });
  const call: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      context.module.modulePath,
      function_.name,
    ),
    arguments: Object.freeze(callArguments),
  });
  const invokeStatements: readonly MojoStatement[] = function_.resultType.kind === "unit"
    ? Object.freeze([Object.freeze({ kind: "expression", expression: call })])
    : Object.freeze([Object.freeze({ kind: "return", expression: call })]);
  const invoke: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "invoke",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_context", type: contextType }),
      Object.freeze({ name: argumentsName, type: argumentType, convention: "var" }),
    ]),
    resultType: function_.resultType,
    asynchronous: false,
    raises: callableType.raises,
    ...(callableType.errorType === undefined ? {} : { errorType: callableType.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: invokeStatements,
  });
  const destroy: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "destroy",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({ name: "context", type: contextType })]),
    resultType: unitType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          runtimeModule,
          "destroy_callable_environment",
        ),
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type: adapterType })]),
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "path", path: "context" }),
        })]),
      }),
    })]),
  });
  return Object.freeze({
    kind: "struct",
    name,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze([]),
    methods: Object.freeze([invoke, destroy]),
    decorators: mojoFieldwiseInitDecorators,
  });
}

function localNamedType(
  context: MojoPlanningContext,
  name: string,
): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: `tsonic.mojo.generated.${context.module.modulePath.join(".")}.${name}`,
    modulePath: context.module.modulePath,
    name,
  });
}

function runtimeNamedType(id: string, name: string): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id,
    modulePath: runtimeModule,
    name,
  });
}
