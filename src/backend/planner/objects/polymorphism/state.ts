import type { Node } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type {
  MojoAnalyzedClass,
  MojoProjectConcreteDispatch,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import { mojoTargetTypeEquals } from "../../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../../target-ast/index.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "../../declarations/parameters.js";
import { planMojoValue } from "../../expressions/value.js";
import { consumeMojoValue } from "../../expressions/value-plan.js";
import {
  orderCallArguments,
  planSelectedArguments,
} from "../../expressions/support.js";
import {
  appendMojoPlanningDiagnostic,
  withMojoErrorType,
  withMojoLocalNameScope,
  withMojoStateInitialization,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { planMojoFunctionStatements } from "../../statements/structured.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import { planMojoGenericParameters } from "../../declarations/project.js";
import { mojoConcreteViewConstruction } from "./adapters.js";
import {
  mojoProjectObjectType,
  mojoProjectStateType,
} from "./types.js";

export function planMojoPolymorphicClassState(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): MojoStructDeclaration | undefined {
  const stateType = mojoProjectStateType(class_);
  const dispatch = context.program.projectDispatch.concreteFor(class_.definition);
  if (stateType === undefined || dispatch === undefined) return undefined;
  const base = directBase(class_, context);
  if (base === null) return undefined;
  const baseStateType = base === undefined
    ? undefined
    : mojoProjectStateType(base.class_, base.type);
  if (base !== undefined && baseStateType === undefined) return undefined;
  registerMojoTypeImports(stateType, context);
  if (baseStateType !== undefined) registerMojoTypeImports(baseStateType, context);
  for (const field of class_.fields) registerMojoTypeImports(field.type, context);
  const methodStorage = dispatch.methodStorages.map((storage) => Object.freeze({
    storage,
    type: storage.storageType,
  }));
  for (const entry of methodStorage) registerMojoTypeImports(entry.type, context);
  for (const storage of dispatch.indexStorages) registerMojoTypeImports(storage.type, context);
  const sourceConstructor = class_.constructors[0];
  const stateContext = withMojoErrorType(
    withMojoStateInitialization(
      withMojoLocalNameScope(context),
      class_.definition,
      class_.targetType,
      stateType,
    ),
    sourceConstructor?.errorType ?? class_.initializationErrorType,
  );
  const parameterPrelude = sourceConstructor === undefined
    ? Object.freeze([])
    : planMojoParameterPrelude(sourceConstructor.parameters, stateContext, planMojoValue, true);
  if (parameterPrelude === undefined) return undefined;
  const baseInitialization = base === undefined || baseStateType === undefined
    ? Object.freeze({ statements: Object.freeze([]), omitted: Object.freeze([]) })
    : planBaseInitialization(class_, sourceConstructor, base.class_, baseStateType, stateContext);
  if (baseInitialization === undefined) return undefined;
  const fieldInitialization: MojoStatement[] = [];
  for (const field of class_.fields) {
    if (field.initializer === undefined) continue;
    const value = planMojoValue(field.initializer, stateContext, field.type);
    if (value === undefined) return undefined;
    fieldInitialization.push(...value.before, Object.freeze({
      kind: "assignment",
      operator: "=",
      left: Object.freeze({
        kind: "member",
        receiver: Object.freeze({ kind: "path", path: "self" }),
        name: field.name,
      }),
      right: value.value,
    }));
  }
  const constructorBody = sourceConstructor === undefined
    ? Object.freeze([])
    : planMojoFunctionStatements(
        sourceConstructor,
        stateContext,
        new Set(baseInitialization.omitted),
      );
  if (constructorBody === undefined) return undefined;
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
      ...parameterPrelude,
      ...methodStorage.map(({ storage }): MojoStatement => Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: "self" }),
          name: storage.name,
        }),
        right: Object.freeze({ kind: "none-literal" }),
      })),
      ...dispatch.indexStorages.map((storage): MojoStatement => Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: "self" }),
          name: storage.name,
        }),
        right: Object.freeze({ kind: "dictionary", entries: Object.freeze([]) }),
      })),
      ...baseInitialization.statements,
      ...fieldInitialization,
      ...constructorBody,
    ]),
  });
  return Object.freeze({
    kind: "struct",
    name: class_.stateName,
    genericParameters: planMojoGenericParameters(class_),
    conformances: Object.freeze([]),
    fields: Object.freeze([
      ...(baseStateType === undefined
        ? []
        : [Object.freeze({ name: "_base", type: baseStateType, compileTime: false })]),
      ...class_.fields.map((field) => Object.freeze({
        name: field.name,
        type: field.type,
        compileTime: false,
      })),
      ...methodStorage.map(({ storage, type }) => Object.freeze({
        name: storage.name,
        type,
        compileTime: false,
      })),
      ...dispatch.indexStorages.map((storage) => Object.freeze({
        name: storage.name,
        type: storage.type,
        compileTime: false,
      })),
    ]),
    methods: Object.freeze([stateConstructor]),
  });
}

export function planMojoPolymorphicClassConstructor(
  class_: MojoAnalyzedClass,
  dispatch: MojoProjectConcreteDispatch,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const ownView = dispatch.views.find((view) => view.view.definition === class_.definition);
  const stateType = mojoProjectStateType(class_);
  if (ownView === undefined || stateType === undefined) return undefined;
  registerMojoTypeImports(stateType, context);
  registerMojoTypeImports(mojoProjectObjectType, context);
  const sourceConstructor = class_.constructors[0];
  const stateArguments = (sourceConstructor?.parameters ?? []).map((parameter) => {
    const value = Object.freeze({ kind: "path" as const, path: parameter.incomingName });
    return Object.freeze({
      value: mojoParameterConvention(parameter.disposition) === "var"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    });
  });
  const object = Object.freeze({
    kind: "construct" as const,
    type: mojoProjectObjectType,
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({
        kind: "construct" as const,
        type: stateType,
        arguments: Object.freeze(stateArguments),
      }),
    })]),
  });
  const construction = mojoConcreteViewConstruction(dispatch, ownView, object);
  if (construction === undefined) return undefined;
  return Object.freeze({
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
    statements: Object.freeze([Object.freeze({
      kind: "assignment",
      operator: "=",
      left: Object.freeze({ kind: "path", path: "self" }),
      right: construction,
    })]),
  });
}

function directBase(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): { readonly class_: MojoAnalyzedClass; readonly type: MojoTargetTypeRef } | undefined | null {
  const edges = class_.heritage.filter((edge) => edge.kind === "extends" && edge.target.kind === "class");
  if (edges.length === 0) return undefined;
  const edge = edges.length === 1 ? edges[0]! : undefined;
  const base = edge === undefined
    ? undefined
    : context.program.declarations.find((declaration): declaration is MojoAnalyzedClass =>
        declaration.kind === "class" && declaration.definition === edge.target);
  if (edge === undefined || base === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_BASE_CLASS_PLAN_MISSING",
      "A polymorphic class requires one exact analyzed direct base class.",
      class_.declaration,
    );
    return null;
  }
  return Object.freeze({ class_: base, type: edge.targetType });
}

function planBaseInitialization(
  class_: MojoAnalyzedClass,
  constructor: MojoAnalyzedClass["constructors"][number] | undefined,
  base: MojoAnalyzedClass,
  baseStateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): { readonly statements: readonly MojoStatement[]; readonly omitted: readonly Node[] } | undefined {
  const sourceStatements = constructor === undefined
    ? Object.freeze([])
    : context.program.source.ast.statements(constructor.body).filter(
        (statement): statement is Node => statement !== undefined,
      );
  const first = sourceStatements[0];
  const expression = first === undefined || !context.program.source.ast.is.IsExpressionStatement(first)
    ? undefined
    : Node_Expression(context.program.source.ast, first);
  const callee = expression === undefined || !context.program.source.ast.is.IsCallExpression(expression)
    ? undefined
    : Node_Expression(context.program.source.ast, expression);
  const explicitSuper = callee !== undefined &&
    context.program.source.ast.kindName(callee) === "KindSuperKeyword"
      ? expression
      : undefined;
  if (constructor !== undefined && explicitSuper === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_BASE_CONSTRUCTOR_CALL_REQUIRED",
      "A derived project constructor must begin with its exact checked super(...) call.",
      constructor.declaration,
    );
    return undefined;
  }
  let before: readonly MojoStatement[] = Object.freeze([]);
  let arguments_: readonly import("../../../target-ast/index.js").MojoCallArgument[] = Object.freeze([]);
  if (explicitSuper !== undefined) {
    const selection = context.program.queries.callSelection(explicitSuper);
    if (selection?.kind !== "project" || selection.target.kind !== "constructor" ||
      !mojoTargetTypeEquals(selection.target.type, baseStateOwnerType(baseStateType, base))) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_BASE_CONSTRUCTOR_SELECTION_MISSING",
        "The checked super(...) call has no exact selected base-class constructor.",
        explicitSuper,
      );
      return undefined;
    }
    const planned = planSelectedArguments(selection.arguments, context, planMojoValue);
    if (planned === undefined) return undefined;
    const ordered = orderCallArguments(
      planned,
      context,
    );
    before = ordered.before;
    arguments_ = ordered.arguments;
  } else {
    const baseConstructor = base.constructors[0];
    if (baseConstructor !== undefined && baseConstructor.parameters.some((parameter) =>
      parameter.omissionKind === "required")) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_IMPLICIT_BASE_CONSTRUCTOR_ARGUMENTS_UNAVAILABLE",
        "An implicit derived constructor cannot call a base constructor with required parameters.",
        class_.declaration,
      );
      return undefined;
    }
  }
  return Object.freeze({
    statements: Object.freeze([
      ...before,
      Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: "self" }),
          name: "_base",
        }),
        right: Object.freeze({
          kind: "construct",
          type: baseStateType,
          arguments: arguments_,
        }),
      }),
    ]),
    omitted: explicitSuper === undefined ? Object.freeze([]) : Object.freeze([first!]),
  });
}

function baseStateOwnerType(
  baseStateType: MojoTargetTypeRef,
  base: MojoAnalyzedClass,
): MojoTargetTypeRef {
  return base.targetType.kind !== "target-named" || baseStateType.kind !== "target-named"
    ? base.targetType
    : Object.freeze({
        ...base.targetType,
        ...(baseStateType.genericArguments === undefined
          ? {}
          : { genericArguments: baseStateType.genericArguments }),
      });
}
