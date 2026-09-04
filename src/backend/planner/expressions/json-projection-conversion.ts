import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import { mojoNativeErrorType } from "../../../target-model/types/error-domains.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../target-ast/index.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  allocateMojoSyntheticDeclarationName,
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
  withMojoDeferredExecution,
  withMojoErrorType,
  withMojoLocalNameScope,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

type SelectedToJsonConversion = Extract<MojoValueConversion, {
  readonly kind: "js-selected-to-json";
}>;

type ConversionPlanner = (
  plan: MojoValuePlan,
  conversion: MojoValueConversion,
  context: MojoPlanningContext,
) => MojoValuePlan | undefined;

export function convertMojoSelectedToJson(
  plan: MojoValuePlan,
  conversion: SelectedToJsonConversion,
  context: MojoPlanningContext,
  convert: ConversionPlanner,
): MojoValuePlan | undefined {
  const dispatchView = context.program.projectDispatch.viewForType(conversion.sourceType);
  const dispatch = dispatchView === undefined
    ? undefined
    : context.program.projectDispatch.callableFor(
        conversion.sourceType,
        conversion.declaration,
        Object.freeze([]),
      );
  if (dispatchView !== undefined && dispatch === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_JSON_TO_JSON_DISPATCH_NOT_SEALED",
      "A selected toJSON projection has no exact sealed project dispatch slot.",
      conversion.declaration,
    );
    return undefined;
  }

  const adapterName = allocateMojoSyntheticDeclarationName(context, "json_projection");
  const adapterType = localNamedType(context, adapterName);
  const callableType = jsonProjectionCallableType();
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(callableType, context);
  const adapter = createJsonProjectionAdapter(
    adapterName,
    adapterType,
    dispatch?.name ?? conversion.methodName,
    conversion,
    context,
    convert,
  );
  if (adapter === undefined) return undefined;
  context.syntheticDeclarations.push(adapter);

  const capturedSource: MojoExpression = conversion.sourceCopy === "explicit"
    ? Object.freeze({ kind: "copy", expression: plan.value })
    : plan.value;
  const environment = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      ["tsonic_runtime"],
      "allocate_callable_environment",
    ),
    arguments: Object.freeze([
      Object.freeze({
        value: Object.freeze({
          kind: "construct",
          type: adapterType,
          arguments: Object.freeze([Object.freeze({ value: capturedSource })]),
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
  }) satisfies MojoExpression;
  const callable = Object.freeze({
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
  }) satisfies MojoExpression;
  return withMojoValue(plan.before, Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      ["tsonic_js"],
      "js_value_from_json_projection",
    ),
    arguments: Object.freeze([Object.freeze({ value: callable })]),
  }));
}

function createJsonProjectionAdapter(
  name: string,
  adapterType: MojoTargetTypeRef,
  methodName: string,
  conversion: SelectedToJsonConversion,
  context: MojoPlanningContext,
  convert: ConversionPlanner,
): MojoStructDeclaration | undefined {
  const contextType = runtimeNamedType(
    "tsonic.mojo.runtime.ErasedCallableContext",
    "ErasedCallableContext",
  );
  const argumentsType = Object.freeze({
    kind: "tuple" as const,
    elements: Object.freeze([nativeStringType()]),
  });
  registerMojoTypeImports(contextType, context);
  registerMojoTypeImports(argumentsType, context);
  registerMojoTypeImports(conversion.resultType, context);

  const contextName = "context";
  const argumentsName = "arguments";
  const pointerName = "projection";
  const receiver = Object.freeze({
    kind: "member",
    receiver: Object.freeze({
      kind: "postfix-deref",
      expression: Object.freeze({ kind: "path", path: pointerName }),
    }),
    name: "source",
  }) satisfies MojoExpression;
  const methodArguments: readonly MojoCallArgument[] = conversion.passesPropertyKey
    ? Object.freeze([Object.freeze({
        value: Object.freeze({
          kind: "element",
          receiver: Object.freeze({ kind: "path", path: argumentsName }),
          index: Object.freeze({ kind: "number-literal", text: "0" }),
        }),
      })])
    : Object.freeze([]);
  const invocation = Object.freeze({
    kind: "method-call",
    receiver,
    name: methodName,
    arguments: methodArguments,
  }) satisfies MojoExpression;
  const adapterContext = withMojoErrorType(
    withMojoLocalNameScope(withMojoDeferredExecution(context)),
    mojoNativeErrorType(),
  );
  const converted = convert(mojoValue(invocation), conversion.resultConversion, adapterContext);
  if (converted === undefined) return undefined;

  const invoke: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "invoke",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: contextName, type: contextType }),
      Object.freeze({ name: argumentsName, type: argumentsType, convention: "var" }),
    ]),
    resultType: jsValueType(),
    asynchronous: false,
    raises: true,
    errorType: mojoNativeErrorType(),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([
      Object.freeze({
        kind: "variable",
        name: pointerName,
        initializer: Object.freeze({
          kind: "method-call",
          receiver: Object.freeze({ kind: "path", path: contextName }),
          name: "unsafe_bitcast",
          genericArguments: Object.freeze([Object.freeze({ kind: "type", type: adapterType })]),
          arguments: Object.freeze([]),
        }),
      }),
      ...converted.before,
      Object.freeze({ kind: "return", expression: converted.value }),
    ]),
  });
  const destroy: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "destroy",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({ name: contextName, type: contextType })]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_runtime"],
          "destroy_callable_environment",
        ),
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type: adapterType })]),
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "path", path: contextName }),
        })]),
      }),
    })]),
  });
  return Object.freeze({
    kind: "struct",
    name,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze([Object.freeze({
      name: "source",
      type: conversion.sourceType,
      compileTime: false,
    })]),
    methods: Object.freeze([invoke, destroy]),
    decorators: mojoFieldwiseInitDecorators,
  });
}

function nativeStringType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "native-string" });
}

function jsValueType(): MojoTargetTypeRef {
  return Object.freeze({ kind: "dynamic", domain: "js" });
}

function jsonProjectionCallableType(): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> {
  return Object.freeze({
    kind: "callable",
    parameters: Object.freeze([Object.freeze({
      convention: "var",
      passing: "consume",
      type: nativeStringType(),
    })]),
    result: jsValueType(),
    raises: true,
    errorType: mojoNativeErrorType(),
  });
}

function localNamedType(context: MojoPlanningContext, name: string): MojoTargetTypeRef {
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
    modulePath: Object.freeze(["tsonic_runtime"]),
    name,
  });
}
