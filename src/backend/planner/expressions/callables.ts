import type { Node } from "@tsonic/tsts";
import type {
  MojoExpression,
  MojoFieldDeclaration,
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../target-ast/index.js";
import type { MojoCallableExpressionSelection } from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoNativeErrorType } from "../../../target-model/types/error-domains.js";
import {
  allocateMojoSyntheticDeclarationName,
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
  withMojoBindingOverrides,
  withMojoDeferredExecution,
  withMojoErrorType,
} from "../program/context.js";
import type {
  MojoBindingPlanOverride,
  MojoPlanningContext,
} from "../program/context.js";
import type { MojoValuePlanner } from "./support.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { consumeMojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoParameterPrelude } from "../declarations/parameters.js";
import { planMojoParameterDeclaration } from "../declarations/parameters.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";
import type { MojoCallableDisposition } from "../../../analysis/representations/model.js";
import { planMojoFunctionBody, planMojoProjectFunction } from "../declarations/project.js";
import { mojoModuleBindingRead } from "../bindings/module-bindings.js";

const runtimeModule = Object.freeze(["tsonic_runtime"]);
const unitType: MojoTargetTypeRef = Object.freeze({ kind: "unit" });

export function planMojoCallableExpression(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  widenedCallableType?: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
): MojoValuePlan | undefined {
  const selection = context.program.queries.callableExpressionSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_CALLABLE_EXPRESSION_PLAN_MISSING",
      "Callable expression has no sealed Mojo callable selection.",
      node,
    );
    return undefined;
  }
  if (selection.parameters.some((parameter) =>
    mojoParameterConvention(parameter.disposition) !== "imm" &&
    mojoParameterConvention(parameter.disposition) !== "var")) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ERASED_CALLABLE_PARAMETER_ABI_UNSUPPORTED",
      "A retained Mojo callable requires value-parameter conventions.",
      node,
    );
    return undefined;
  }

  const disposition = context.program.representations.callable(node);
  if (disposition === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_CALLABLE_DISPOSITION_MISSING",
      "Callable expression has no sealed physical representation disposition.",
      node,
    );
    return undefined;
  }
  if (disposition.kind !== "erased") {
    return planNativeCallableExpression(
      selection,
      disposition,
      context,
      planValue,
    );
  }

  const callableType = widenedCallableType ?? selection.callableType;
  registerMojoTypeImports(callableType, context);
  const environmentName = context.callableArtifactNames.get(node) ??
    allocateMojoSyntheticDeclarationName(context, "callable_environment");
  if (!context.callableArtifactNames.has(node)) {
    context.callableArtifactNames.set(node, environmentName);
    const declaration = planCallableEnvironment(
      selection,
      environmentName,
      context,
      planValue,
      callableType,
    );
    if (declaration === undefined) return undefined;
    context.syntheticDeclarations.push(declaration);
  }

  const environmentType = localNamedType(context, environmentName);
  const captureValues: MojoExpression[] = selection.captures.map((capture) =>
    Object.freeze({ kind: "path" as const, path: capture.name }));
  const before: MojoStatement[] = [];
  const recursiveStorageName = selection.recursiveBinding === undefined
    ? undefined
    : allocateMojoSyntheticName(context, "recursive_callable_storage");
  if (recursiveStorageName !== undefined) {
    const storageType = locationType(optionalType(callableType));
    registerMojoTypeImports(storageType, context);
    before.push(Object.freeze({
      kind: "variable",
      name: recursiveStorageName,
      type: storageType,
      initializer: Object.freeze({
        kind: "construct",
        type: storageType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "construct",
            type: optionalType(callableType),
            arguments: Object.freeze([]),
          }),
        })]),
      }),
    }));
  }
  const ownerName = allocateMojoSyntheticName(context, "callable_owner");
  const allocation: MojoExpression = Object.freeze({
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
          type: environmentType,
          arguments: Object.freeze([
            ...captureValues.map((value) => Object.freeze({ value })),
            ...(recursiveStorageName === undefined
              ? []
              : [Object.freeze({
                  value: Object.freeze({ kind: "path" as const, path: recursiveStorageName }),
                })]),
          ]),
        }),
      }),
      Object.freeze({
        value: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: environmentName }),
          name: "destroy",
        }),
      }),
    ]),
  });
  before.push(Object.freeze({
    kind: "variable",
    name: ownerName,
    initializer: allocation,
  }));
  const callable = Object.freeze({
    kind: "construct",
    type: callableType,
    arguments: Object.freeze([
      Object.freeze({ value: Object.freeze({ kind: "path", path: ownerName }) }),
      Object.freeze({ value: Object.freeze({
        kind: "member",
        receiver: Object.freeze({ kind: "path", path: environmentName }),
        name: "invoke",
      }) }),
    ]),
  } satisfies MojoExpression);
  if (recursiveStorageName === undefined) return withMojoValue(before, callable);
  const callableValueName = allocateMojoSyntheticName(context, "recursive_callable_value");
  before.push(Object.freeze({
    kind: "variable",
    name: callableValueName,
    type: callableType,
    initializer: callable,
  }), Object.freeze({
    kind: "expression",
    expression: Object.freeze({
      kind: "method-call",
      receiver: Object.freeze({ kind: "path", path: recursiveStorageName }),
      name: "write",
      arguments: Object.freeze([Object.freeze({
        value: Object.freeze({
          kind: "construct",
          type: optionalType(callableType),
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "path", path: callableValueName }),
          })]),
        }),
      })]),
    }),
  }));
  return withMojoValue(before, Object.freeze({ kind: "path", path: callableValueName }));
}

function planNativeCallableExpression(
  selection: MojoCallableExpressionSelection,
  disposition: Exclude<MojoCallableDisposition, { readonly kind: "erased" }>,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  if (disposition.declaration !== undefined) {
    const binding = context.program.queries.moduleBinding(disposition.declaration);
    if (binding?.disposition.kind === "direct-function") {
      const expression = mojoModuleBindingRead(binding, context);
      return expression === undefined ? undefined : withMojoValue(Object.freeze([]), expression);
    }
  }
  if (disposition.kind === "native-closure") {
    return planNativeLambda(selection, context, planValue);
  }
  const existingName = context.callableArtifactNames.get(selection.expression);
  const name = existingName ?? allocateMojoSyntheticDeclarationName(context, "callable");
  if (existingName === undefined) {
    context.callableArtifactNames.set(selection.expression, name);
    const declaration = planMojoProjectFunction(Object.freeze({
      kind: selection.kind,
      declaration: selection.expression,
      sourceFile: selection.sourceFile,
      name,
      typeParameters: selection.typeParameters,
      parameters: selection.parameters,
      resultType: selection.resultType,
      body: selection.body,
      asynchronous: selection.asynchronous,
      raises: selection.raises,
      ...(selection.errorType === undefined ? {} : { errorType: selection.errorType }),
    }), withMojoDeferredExecution(context));
    if (declaration === undefined) return undefined;
    context.syntheticDeclarations.push(declaration);
  }
  return withMojoValue(
    Object.freeze([]),
    Object.freeze({ kind: "path", path: name }),
  );
}

function planNativeLambda(
  selection: MojoCallableExpressionSelection,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const deferredContext = withMojoDeferredExecution(context);
  const body = planValue(selection.body, deferredContext, selection.resultType);
  if (body === undefined) return undefined;
  if (body.before.length !== 0) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_NATIVE_CLOSURE_REQUIRES_STATEMENT_PRELUDE",
      "A callable classified as a native Mojo closure produced an unsealed statement prelude.",
      selection.expression,
    );
    return undefined;
  }
  return withMojoValue(Object.freeze([]), Object.freeze({
    kind: "lambda",
    parameters: Object.freeze(selection.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, deferredContext))),
    captures: Object.freeze(selection.captures.map((capture) => Object.freeze({
      name: capture.name,
      convention: capture.storage === "location" ? "mut" as const : "imm" as const,
    }))),
    resultType: selection.resultType,
    raises: selection.raises,
    expression: body.value,
  }));
}

function planCallableEnvironment(
  selection: MojoCallableExpressionSelection,
  environmentName: string,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
): MojoStructDeclaration | undefined {
  const environmentType = localNamedType(context, environmentName);
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
  registerMojoTypeImports(callableType.result, context);

  const fields: MojoFieldDeclaration[] = selection.captures.map((capture) => {
    const type = capture.storage === "location" ? locationType(capture.type) : capture.type;
    registerMojoTypeImports(type, context);
    return Object.freeze({
      name: capture.name,
      type,
      compileTime: false,
    });
  });
  if (selection.recursiveBinding !== undefined) {
    const type = locationType(optionalType(callableType));
    registerMojoTypeImports(type, context);
    fields.push(Object.freeze({
      name: selection.recursiveBinding.name,
      type,
      compileTime: false,
    }));
  }
  const contextName = `${environmentName}_context`;
  const argumentsName = `${environmentName}_arguments`;
  const pointerName = `${environmentName}_pointer`;
  const environmentValue: MojoExpression = Object.freeze({
    kind: "postfix-deref",
    expression: Object.freeze({ kind: "path", path: pointerName }),
  });
  const overrides = new Map<Node, MojoBindingPlanOverride>();
  for (const capture of selection.captures) {
    const field: MojoExpression = Object.freeze({
      kind: "member",
      receiver: environmentValue,
      name: capture.name,
    });
    overrides.set(capture.declaration, Object.freeze({
      expression: field,
      storage: capture.storage,
    }));
  }
  if (selection.recursiveBinding !== undefined) {
    const field: MojoExpression = Object.freeze({
      kind: "member",
      receiver: environmentValue,
      name: selection.recursiveBinding.name,
    });
    overrides.set(selection.recursiveBinding.declaration, Object.freeze({
      expression: Object.freeze({
        kind: "method-call",
        receiver: Object.freeze({
          kind: "method-call",
          receiver: field,
          name: "borrow",
          arguments: Object.freeze([]),
        }),
        name: "value",
        arguments: Object.freeze([]),
      }),
      storage: "value",
    }));
  }
  const callableContext = withMojoErrorType(
    withMojoBindingOverrides(withMojoDeferredExecution(context), overrides),
    callableType.raises
      ? callableType.errorType ?? mojoNativeErrorType()
      : undefined,
  );
  const tuplePrelude: MojoStatement[] = selection.parameters.length === 0
    ? []
    : [Object.freeze({
        kind: "tuple-variable" as const,
        names: Object.freeze(selection.parameters.map((parameter) =>
          parameter.omissionKind === "initializer" ? parameter.incomingName : parameter.name)),
        initializer: consumeMojoValue(
          Object.freeze({ kind: "path" as const, path: argumentsName }),
          argumentType,
          context.program.lifecycle,
        ),
      })];
  const parameterPrelude = planMojoParameterPrelude(
    selection.parameters,
    callableContext,
    planValue,
    false,
  );
  if (parameterPrelude === undefined) return undefined;
  const body = planCallableBody(selection, callableContext);
  if (body === undefined) return undefined;
  const invoke: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "invoke",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: contextName, type: contextType }),
      Object.freeze({ name: argumentsName, type: argumentType, convention: "var" }),
    ]),
    resultType: callableType.result,
    asynchronous: false,
    raises: callableType.raises,
    ...(callableType.errorType === undefined ? {} : { errorType: callableType.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([
      Object.freeze({
        kind: "variable",
        name: pointerName,
        initializer: Object.freeze({
          kind: "method-call",
          receiver: Object.freeze({ kind: "path", path: contextName }),
          name: "unsafe_bitcast",
          genericArguments: Object.freeze([Object.freeze({
            kind: "type",
            type: environmentType,
          })]),
          arguments: Object.freeze([]),
        }),
      }),
      ...tuplePrelude,
      ...parameterPrelude,
      ...body,
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
        genericArguments: Object.freeze([Object.freeze({
          kind: "type",
          type: environmentType,
        })]),
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "path", path: contextName }),
        })]),
      }),
    })]),
  });
  return Object.freeze({
    kind: "struct",
    name: environmentName,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze(fields),
    methods: Object.freeze([invoke, destroy]),
    decorators: mojoFieldwiseInitDecorators,
  });
}

function planCallableBody(
  selection: MojoCallableExpressionSelection,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  return planMojoFunctionBody(Object.freeze({
    kind: selection.kind,
    declaration: selection.expression,
    sourceFile: selection.sourceFile,
    name: "invoke",
    typeParameters: selection.typeParameters,
    parameters: selection.parameters,
    resultType: selection.resultType,
    body: selection.body,
    asynchronous: selection.asynchronous,
    raises: selection.raises,
    ...(selection.errorType === undefined ? {} : { errorType: selection.errorType }),
  }), context);
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

function locationType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.Location",
    modulePath: runtimeModule,
    name: "Location",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: value })]),
  });
}

function optionalType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value });
}
