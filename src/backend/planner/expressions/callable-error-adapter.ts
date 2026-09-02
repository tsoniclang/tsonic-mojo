import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/render.js";
import { mojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

const runtimeModule = Object.freeze(["tsonic_runtime"]);
const unitType: MojoTargetTypeRef = Object.freeze({ kind: "unit" });

export function adaptMojoRaisingCallableError(
  expression: MojoExpression,
  sourceType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  errorConversion: MojoValueConversion,
  context: MojoPlanningContext,
  convert: (
    plan: MojoValuePlan,
    conversion: MojoValueConversion,
    context: MojoPlanningContext,
  ) => MojoValuePlan | undefined,
): MojoExpression | undefined {
  const sourceErrorType = sourceType.errorType;
  const targetErrorType = targetType.errorType;
  if (!sourceType.raises || sourceErrorType === undefined ||
    !targetType.raises || targetErrorType === undefined) return undefined;

  registerMojoModuleImport(context, runtimeModule);
  registerMojoTypeImports(sourceType, context);
  registerMojoTypeImports(targetType, context);
  const name = allocateMojoSyntheticName(context, "callable_error_adapter");
  const adapterType = localNamedType(context, name);
  const contextType = runtimeNamedType(
    "tsonic.mojo.runtime.ErasedCallableContext",
    "ErasedCallableContext",
  );
  const argumentType: MojoTargetTypeRef = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(targetType.parameters.map((parameter) => parameter.type)),
  });
  const contextName = `${name}_context`;
  const argumentsName = `${name}_arguments`;
  const pointerName = `${name}_pointer`;
  const errorName = `${name}_error`;
  const pointerValue: MojoExpression = Object.freeze({
    kind: "postfix-deref",
    expression: Object.freeze({ kind: "path", path: pointerName }),
  });
  const call: MojoExpression = Object.freeze({
    kind: "method-call",
    receiver: Object.freeze({
      kind: "member",
      receiver: pointerValue,
      name: "callable",
    }),
    name: "call",
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({
        kind: "consume",
        expression: Object.freeze({ kind: "path", path: argumentsName }),
      }),
    })]),
  });
  const convertedError = convert(
    mojoValue(Object.freeze({ kind: "path", path: errorName })),
    errorConversion,
    context,
  );
  if (convertedError === undefined) return undefined;
  const invoke: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "invoke",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: contextName, type: contextType }),
      Object.freeze({ name: argumentsName, type: argumentType, convention: "var" }),
    ]),
    resultType: targetType.result,
    asynchronous: false,
    raises: true,
    errorType: targetErrorType,
    decorators: Object.freeze(["staticmethod"]),
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
      Object.freeze({
        kind: "try",
        statements: targetType.result.kind === "unit"
          ? Object.freeze([Object.freeze({ kind: "expression", expression: call })])
          : Object.freeze([Object.freeze({ kind: "return", expression: call })]),
        catches: Object.freeze([Object.freeze({
          name: errorName,
          statements: Object.freeze([
            ...convertedError.before,
            Object.freeze({ kind: "raise", expression: convertedError.value }),
          ]),
        })]),
      }),
    ]),
  });
  const destroy: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "destroy",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({ name: contextName, type: contextType })]),
    resultType: unitType,
    asynchronous: false,
    raises: false,
    decorators: Object.freeze(["staticmethod"]),
    statements: Object.freeze([Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "call",
        callee: Object.freeze({
          kind: "path",
          path: "tsonic_runtime.destroy_callable_environment",
        }),
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type: adapterType })]),
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "path", path: contextName }),
        })]),
      }),
    })]),
  });
  const declaration: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze([Object.freeze({
      name: "callable",
      type: sourceType,
      compileTime: false,
    })]),
    methods: Object.freeze([invoke, destroy]),
    decorators: Object.freeze(["fieldwise_init"]),
  });
  context.syntheticDeclarations.push(declaration);

  const environment: MojoExpression = Object.freeze({
    kind: "call",
    callee: Object.freeze({
      kind: "path",
      path: "tsonic_runtime.allocate_callable_environment",
    }),
    arguments: Object.freeze([
      Object.freeze({
        value: Object.freeze({
          kind: "construct",
          type: adapterType,
          arguments: Object.freeze([Object.freeze({ value: expression })]),
        }),
      }),
      Object.freeze({ value: Object.freeze({ kind: "path", path: `${name}.destroy` }) }),
    ]),
  });
  return Object.freeze({
    kind: "construct",
    type: targetType,
    arguments: Object.freeze([
      Object.freeze({ value: environment }),
      Object.freeze({ value: Object.freeze({ kind: "path", path: `${name}.invoke` }) }),
    ]),
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
