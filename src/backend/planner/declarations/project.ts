import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedTypeAlias,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoTargetTypeKey } from "../../../target-model/types/key.js";
import type {
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../target-ast/index.js";
import { planMojoValue } from "../expressions/value.js";
import { consumeMojoValue } from "../expressions/value-plan.js";
import {
  withMojoErrorType,
  withMojoGenericSubstitutions,
  withMojoLocalNameScope,
  withMojoSelfType,
  withMojoStateInitialization,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { planMojoFunctionStatements } from "../statements/structured.js";
import { registerMojoTypeImports } from "../types/imports.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "./parameters.js";
import {
  mojoReferenceErrorWritableMethod,
  mojoReferenceIdentityEqualityMethod,
} from "./reference-wrapper.js";
import { mojoStateStorageType } from "./state-storage.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";
import { mojoGenericParameterReference } from "../../../target-model/types/constructors.js";
import type { MojoSourceCallableSpecializationVariant } from "../../../analysis/callables/specializations.js";
import {
  specializeMojoFunctionDeclaration,
  substituteMojoDeclaration,
} from "../types/substitution.js";
import { planMojoGenericParameters } from "./generic-parameters.js";
import {
  constructorAdapterRequiresDeclaration,
  planMojoConstructorImplementationAdapter,
  planMojoMemberImplementationAdapter,
} from "../callables/implementation-adapters.js";

export interface MojoProjectFunctionPlanOptions {
  readonly specialization?: MojoSourceCallableSpecializationVariant;
  readonly targetName?: string;
}

export function planMojoProjectFunction(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  self?: MojoFunctionDeclaration["self"],
  options: MojoProjectFunctionPlanOptions = {},
): MojoFunctionDeclaration | undefined {
  const specialization = options.specialization;
  const specializedContext: MojoPlanningContext = specialization === undefined
    ? context
    : Object.freeze({
        ...withMojoGenericSubstitutions(context, specialization.substitutions),
        syntheticDeclarations: [],
        callableArtifactNames: new WeakMap<Node, string>(),
      });
  registerMojoTypeImports(function_.resultType, specializedContext);
  if (function_.errorType !== undefined) {
    registerMojoTypeImports(function_.errorType, specializedContext);
  }
  const functionContext = withMojoSelfType(
    withMojoErrorType(withMojoLocalNameScope(specializedContext), function_.errorType),
    self === undefined ? undefined : function_.owner?.type,
  );
  const parameterPrelude = planMojoParameterPrelude(
    function_.parameters,
    functionContext,
    planMojoValue,
    true,
  );
  if (parameterPrelude === undefined) return undefined;
  const bodyStatements = planMojoFunctionBody(function_, functionContext);
  if (bodyStatements === undefined) return undefined;
  const statements = Object.freeze([
    ...parameterPrelude,
    ...planLocationParameterPrelude(function_, functionContext),
    ...bodyStatements,
  ]);
  const declaration: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: options.targetName ?? function_.name,
    genericParameters: planMojoGenericParameters(function_),
    parameters: Object.freeze(function_.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, specializedContext))),
    resultType: function_.resultType,
    asynchronous: function_.asynchronous,
    raises: function_.raises,
    ...(function_.errorType === undefined ? {} : { errorType: function_.errorType }),
    statements,
    ...(self === undefined ? {} : { self }),
  });
  if (specialization === undefined) return declaration;
  const transformed = specializeMojoFunctionDeclaration(
    declaration,
    specialization.substitutions,
    options.targetName ?? specialization.targetName,
  );
  context.syntheticDeclarations.push(...specializedContext.syntheticDeclarations.map((synthetic) =>
    substituteMojoDeclaration(synthetic, specialization.substitutions)));
  return transformed;
}

export function planMojoProjectFunctionVariants(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  self?: MojoFunctionDeclaration["self"],
  targetName?: (variant: MojoSourceCallableSpecializationVariant) => string | undefined,
): readonly MojoFunctionDeclaration[] | undefined {
  const specializations = context.program.sourceCallableSpecializations;
  if (!specializations.requiresSpecialization(function_.declaration)) {
    const declaration = planMojoProjectFunction(function_, context, self);
    return declaration === undefined ? undefined : Object.freeze([declaration]);
  }
  const variants = specializations.variantsForCallable(function_.declaration);
  if (variants.length === 0) return undefined;
  const declarations: MojoFunctionDeclaration[] = [];
  for (const variant of variants) {
    const name = targetName?.(variant) ?? variant.targetName;
    if (name === undefined) return undefined;
    const declaration = planMojoProjectFunction(function_, context, self, {
      specialization: variant,
      targetName: name,
    });
    if (declaration === undefined) return undefined;
    declarations.push(declaration);
  }
  return Object.freeze(declarations);
}

export function planMojoFunctionBody(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (context.program.source.ast.is.IsBlock(function_.body)) {
    return planMojoFunctionStatements(function_, context);
  }
  const body = planMojoValue(function_.body, context, function_.resultType);
  if (body === undefined) return undefined;
  return Object.freeze([
    ...body.before,
    function_.resultType.kind === "unit"
      ? Object.freeze({ kind: "expression" as const, expression: body.value })
      : Object.freeze({ kind: "return" as const, expression: body.value }),
  ]);
}

export function planMojoProjectClass(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] | undefined {
  const genericParameters_ = planMojoGenericParameters(class_);
  const genericArguments = class_.typeParameters.map(mojoGenericParameterReference);
  const stateType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: `${class_.targetType.kind === "target-named" ? class_.targetType.id : class_.name}:state`,
    modulePath: Object.freeze([]),
    name: class_.stateName,
    ...(genericArguments.length === 0 ? {} : { genericArguments: Object.freeze(genericArguments) }),
  });
  const arcType = mojoStateStorageType(stateType, class_.stateStorage);
  registerMojoTypeImports(arcType, context);
  for (const field of class_.fields) registerMojoTypeImports(field.type, context);
  if (class_.initializationErrorType !== undefined) {
    registerMojoTypeImports(class_.initializationErrorType, context);
  }
  const sourceConstructor = class_.constructors[0];
  const implementationAdapters = context.program.callableImplementationAdapters.filter(
    (adapter) => adapter.owner?.definition === class_.definition,
  );
  const constructorAdapters = implementationAdapters.filter((adapter) =>
    adapter.kind === "constructor-overload");
  const stateContext = withMojoErrorType(
    withMojoStateInitialization(
      withMojoLocalNameScope(context),
      class_.definition,
      class_.targetType,
      stateType,
    ),
    sourceConstructor?.errorType ?? class_.initializationErrorType,
  );
  const stateInitializationStatements: MojoStatement[] = [];
  for (const field of class_.fields) {
    if (field.initializer === undefined) continue;
    const plan = planMojoValue(field.initializer, stateContext, field.type);
    if (plan === undefined) return undefined;
    stateInitializationStatements.push(...plan.before, Object.freeze({
      kind: "assignment" as const,
      operator: "=" as const,
      left: Object.freeze({
        kind: "member" as const,
        receiver: Object.freeze({ kind: "path" as const, path: "self" }),
        name: field.name,
      }),
      right: plan.value,
    }));
  }
  const sourceConstructorStatements = sourceConstructor === undefined
    ? Object.freeze([])
    : planMojoFunctionStatements(sourceConstructor, stateContext);
  if (sourceConstructorStatements === undefined) return undefined;
  const stateParameterPrelude = sourceConstructor === undefined
    ? Object.freeze([])
    : planMojoParameterPrelude(sourceConstructor.parameters, stateContext, planMojoValue, true);
  if (stateParameterPrelude === undefined) return undefined;
  const stateConstructor: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze((sourceConstructor?.parameters ?? []).map((parameter) =>
      planMojoParameterDeclaration(parameter, stateContext))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: sourceConstructor?.raises === true || class_.initializationErrorType !== undefined,
    ...(sourceConstructor?.errorType === undefined && class_.initializationErrorType === undefined
      ? {}
      : { errorType: sourceConstructor?.errorType ?? class_.initializationErrorType }),
    self: "out self",
    statements: Object.freeze([
      ...stateParameterPrelude,
      ...(sourceConstructor === undefined ? [] : planLocationParameterPrelude(sourceConstructor, stateContext)),
      ...stateInitializationStatements,
      ...sourceConstructorStatements,
    ]),
  });
  const stateAdapterConstructors = constructorAdapters
    .filter(constructorAdapterRequiresDeclaration)
    .map((adapter) => planMojoConstructorImplementationAdapter(adapter, stateType, stateContext));
  if (stateAdapterConstructors.some((adapter) => adapter === undefined)) return undefined;
  const state: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.stateName,
    genericParameters: genericParameters_,
    conformances: Object.freeze([]),
    fields: Object.freeze(class_.fields.map((field) => Object.freeze({
      name: field.name,
      type: field.type,
      compileTime: false,
    }))),
    methods: Object.freeze([
      stateConstructor,
      ...(stateAdapterConstructors as MojoFunctionDeclaration[]),
    ]),
  });
  const fieldArguments = (sourceConstructor?.parameters ?? []).map((parameter) => {
    const value = Object.freeze({ kind: "path" as const, path: parameter.incomingName });
    const inputType = parameter.omissionKind === "rest" ? parameter.type : parameter.callType;
    return Object.freeze({
      value: mojoParameterConvention(parameter.disposition) === "var"
        ? consumeMojoValue(value, inputType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    });
  });
  const stateConstruction = Object.freeze({
    kind: "construct" as const,
    type: stateType,
    arguments: Object.freeze(fieldArguments),
  });
  const arcConstruction = Object.freeze({
    kind: "construct" as const,
    type: arcType,
    arguments: Object.freeze([{ value: stateConstruction }]),
  });
  const initializeState: MojoStatement = Object.freeze({
    kind: "assignment",
    operator: "=",
    left: Object.freeze({
      kind: "member",
      receiver: Object.freeze({ kind: "path", path: "self" }),
      name: "_state",
    }),
    right: arcConstruction,
  });
  const constructor: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze((sourceConstructor?.parameters ?? []).map((parameter) =>
      planMojoParameterDeclaration(parameter, context))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: sourceConstructor?.raises === true || class_.initializationErrorType !== undefined,
    ...(sourceConstructor?.errorType === undefined && class_.initializationErrorType === undefined
      ? {}
      : { errorType: sourceConstructor?.errorType ?? class_.initializationErrorType }),
    self: "out self",
    statements: Object.freeze([initializeState]),
  });
  const publicConstructors = constructorAdapters.length === 0
    ? Object.freeze([constructor])
    : constructorAdapters.map((adapter) => planMojoProjectConstructorForwarder(
        adapter,
        stateType,
        arcType,
        context,
      ));
  if (publicConstructors.some((adapter) => adapter === undefined)) return undefined;
  const memberAdapters = implementationAdapters
    .filter((adapter) => adapter.kind === "instance-method-overload" ||
      adapter.kind === "static-method-overload")
    .map((adapter) => planMojoMemberImplementationAdapter(adapter, context));
  if (memberAdapters.some((adapter) => adapter === undefined)) return undefined;
  const methods: MojoFunctionDeclaration[] = [
    ...(publicConstructors as MojoFunctionDeclaration[]),
    ...(memberAdapters as MojoFunctionDeclaration[]),
    mojoReferenceIdentityEqualityMethod(class_.targetType),
    ...(class_.errorRole === "typed"
      ? [mojoReferenceErrorWritableMethod(
          class_.name,
          class_.fields.find((field) => field.sourceName === "message" &&
            (field.type.kind === "native-string" ||
              (field.type.kind === "target-named" && field.type.id === "tsonic.mojo.js.JsString")))?.name,
          Object.freeze({ storage: class_.stateStorage, stateType }),
        )]
      : []),
  ];
  for (const method of class_.methods) {
    const planned = planMojoProjectFunctionVariants(
      method,
      context,
      method.static === true ? undefined : "self",
    );
    if (planned === undefined) return undefined;
    methods.push(...planned.map((declaration) => method.static === true
      ? Object.freeze({ ...declaration, decorators: mojoStaticMethodDecorators })
      : declaration));
  }
  for (const accessor of class_.accessors) {
    const planned = planMojoProjectFunctionVariants(
      accessor,
      context,
      accessor.static === true ? undefined : "self",
    );
    if (planned === undefined) return undefined;
    methods.push(...planned.map((declaration) => accessor.static === true
      ? Object.freeze({ ...declaration, decorators: mojoStaticMethodDecorators })
      : declaration));
  }
  const wrapper: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.name,
    genericParameters: genericParameters_,
    conformances: Object.freeze([Object.freeze({
      kind: "target-named",
      id: "mojo.builtin.ImplicitlyCopyable",
      modulePath: Object.freeze([]),
      name: "ImplicitlyCopyable",
    }), Object.freeze({
      kind: "target-named",
      id: "mojo.builtin.Equatable",
      modulePath: Object.freeze([]),
      name: "Equatable",
    }), ...(class_.errorRole === "typed" ? [Object.freeze({
      kind: "target-named" as const,
      id: "mojo.builtin.Writable",
      modulePath: Object.freeze([]),
      name: "Writable",
    })] : [])]),
    fields: Object.freeze([Object.freeze({
      name: "_state",
      type: arcType,
      compileTime: false,
    })]),
    methods: Object.freeze(methods),
  });
  return Object.freeze([state, wrapper]);
}

function planMojoProjectConstructorForwarder(
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


export function planMojoProjectEnum(enum_: MojoAnalyzedEnum): MojoStructDeclaration {
  const enumType = enum_.targetType;
  const int64Type: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: "int64" });
  return Object.freeze({
    kind: "struct",
    name: enum_.name,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.Equatable",
        modulePath: Object.freeze([]),
        name: "Equatable",
      }),
      Object.freeze({
        kind: "target-named",
        id: "mojo.builtin.TrivialRegisterPassable",
        modulePath: Object.freeze([]),
        name: "TrivialRegisterPassable",
      }),
    ]),
    fields: Object.freeze([
      Object.freeze({ name: "value", type: int64Type, compileTime: false }),
      ...enum_.members.map((member) => Object.freeze({
        name: member.name,
        type: enumType,
        compileTime: true,
        initializer: Object.freeze({
          kind: "construct" as const,
          type: enumType,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "number-literal" as const, text: String(member.value) }),
          })]),
        }),
      })),
    ]),
    methods: Object.freeze([]),
    decorators: mojoFieldwiseInitDecorators,
  });
}

export function planMojoProjectTypeAlias(
  alias: MojoAnalyzedTypeAlias,
  context: MojoPlanningContext,
): import("../../target-ast/index.js").MojoTypeAliasDeclaration {
  registerMojoTypeImports(alias.value, context, mojoTargetTypeKey(alias.value));
  for (const parameter of alias.typeParameters) {
    for (const constraint of parameter.constraints) registerMojoTypeImports(constraint, context);
    if (parameter.defaultArgument?.kind === "type") {
      registerMojoTypeImports(parameter.defaultArgument.type, context);
    }
  }
  return Object.freeze({
    kind: "type-alias",
    name: alias.name,
    genericParameters: planMojoGenericParameters(alias),
    value: alias.value,
    aliasedTypeKey: mojoTargetTypeKey(alias.value),
  });
}

export function planLocationParameterPrelude(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] {
  const statements: MojoStatement[] = [];
  for (const parameter of function_.parameters) {
    const storage = context.program.queries.locationStorage(parameter.declaration);
    if (storage === undefined) continue;
    const locationType: MojoTargetTypeRef = Object.freeze({
      kind: "target-named",
      id: "tsonic.mojo.runtime.Location",
      modulePath: Object.freeze(["tsonic_runtime"]),
      name: "Location",
      genericArguments: Object.freeze([Object.freeze({ kind: "type", type: parameter.type })]),
    });
    registerMojoTypeImports(locationType, context);
    statements.push(Object.freeze({
      kind: "variable",
      name: storage.name,
      type: locationType,
      initializer: Object.freeze({
        kind: "construct",
        type: locationType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({ kind: "path", path: parameter.name }),
        })]),
      }),
    }));
  }
  return Object.freeze(statements);
}
