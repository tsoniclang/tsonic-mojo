import type {
  MojoAnalyzedClass,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import { planMojoValue } from "../expressions/value.js";
import { withMojoStateInitialization } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { planMojoFunctionStatements } from "../statements/structured.js";
import { registerMojoTypeImports } from "../types/render.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "./parameters.js";
import {
  mojoReferenceErrorWritableMethod,
  mojoReferenceIdentityEqualityMethod,
} from "./reference-wrapper.js";
import { mojoStateStorageType } from "./state-storage.js";

export function planMojoProjectFunction(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  self?: MojoFunctionDeclaration["self"],
): MojoFunctionDeclaration | undefined {
  registerMojoTypeImports(function_.resultType, context);
  if (function_.errorType !== undefined) registerMojoTypeImports(function_.errorType, context);
  const parameterPrelude = planMojoParameterPrelude(
    function_.parameters,
    context,
    planMojoValue,
    true,
  );
  if (parameterPrelude === undefined) return undefined;
  const bodyStatements = planMojoFunctionStatements(function_, context);
  if (bodyStatements === undefined) return undefined;
  const statements = Object.freeze([
    ...parameterPrelude,
    ...planLocationParameterPrelude(function_, context),
    ...bodyStatements,
  ]);
  return Object.freeze({
    kind: "function",
    name: function_.name,
    genericParameters: genericParameters(function_),
    parameters: Object.freeze(function_.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, context))),
    resultType: function_.resultType,
    asynchronous: function_.asynchronous,
    raises: function_.raises,
    ...(function_.errorType === undefined ? {} : { errorType: function_.errorType }),
    statements,
    ...(self === undefined ? {} : { self }),
  });
}

export function planMojoProjectClass(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] | undefined {
  const genericParameters_ = genericParameters(class_);
  const genericArguments = class_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    type: Object.freeze({ kind: "type-parameter" as const, name: parameter.name }),
  }));
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
  const stateContext = withMojoStateInitialization(context, class_.targetType, stateType);
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
    methods: Object.freeze([stateConstructor]),
  });
  const fieldArguments = (sourceConstructor?.parameters ?? []).map((parameter) => Object.freeze({
    value: Object.freeze({ kind: "path" as const, path: parameter.incomingName }),
    ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
  }));
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
  const methods: MojoFunctionDeclaration[] = [
    constructor,
    mojoReferenceIdentityEqualityMethod(class_.targetType),
    ...(class_.errorRole === "typed"
      ? [mojoReferenceErrorWritableMethod(
          class_.name,
          class_.fields.find((field) => field.sourceName === "message" &&
            (field.type.kind === "native-string" ||
              (field.type.kind === "target-named" && field.type.id === "tsonic.mojo.js.JsString")))?.name,
        )]
      : []),
  ];
  for (const method of class_.methods) {
    const planned = planMojoProjectFunction(method, context, method.static === true ? undefined : "self");
    if (planned === undefined) return undefined;
    methods.push(method.static === true
      ? Object.freeze({ ...planned, decorators: Object.freeze(["staticmethod"]) })
      : planned);
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
    decorators: Object.freeze(["fieldwise_init"]),
  });
}

function planLocationParameterPrelude(
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

function genericParameters(
  declaration: Pick<MojoAnalyzedFunction | MojoAnalyzedClass | MojoAnalyzedInterface, "typeParameters">,
) {
  return Object.freeze(declaration.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    name: parameter.name,
    position: "positional-or-keyword" as const,
    variadic: false,
    constraints: parameter.constraints,
  })));
}
