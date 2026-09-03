import type {
  MojoAnalyzedParameter,
  MojoProjectConcreteDispatch,
  MojoProjectConcreteViewDispatch,
  MojoProjectDispatchFieldAdapter,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoStatement,
} from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import { consumeMojoValue } from "../../expressions/value-plan.js";
import { applyMojoConversion } from "../../expressions/support.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoMemberPath,
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStateType,
  mojoProjectStaticMember,
} from "./types.js";

export function planMojoConcreteDispatchMethods(
  dispatch: MojoProjectConcreteDispatch,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const methods: MojoFunctionDeclaration[] = [];
  for (const view of dispatch.views) {
    const factory = planViewFactory(dispatch, view, context);
    if (factory === undefined) return undefined;
    methods.push(factory);
    for (const adapter of view.callableAdapters) {
      const planned = planCallableAdapter(dispatch, adapter, context);
      if (planned === undefined) return undefined;
      methods.push(planned);
    }
    for (const adapter of view.fieldAdapters) {
      const planned = planFieldAdapterMethods(dispatch, adapter, context);
      if (planned === undefined) return undefined;
      methods.push(...planned);
    }
  }
  return Object.freeze(methods);
}

export function mojoConcreteViewConstruction(
  dispatch: MojoProjectConcreteDispatch,
  view: MojoProjectConcreteViewDispatch,
  object: MojoExpression,
): MojoExpression | undefined {
  const arguments_: MojoCallArgument[] = [Object.freeze({ name: "_object", value: object })];
  for (const variant of view.view.callables) {
    const adapter = view.callableAdapters.find((candidate) => candidate.variant === variant);
    if (adapter === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: variant.slotName,
      value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.adapterName),
    }));
  }
  for (const field of view.view.fields) {
    const adapter = view.fieldAdapters.find((candidate) => candidate.field === field);
    if (adapter === undefined) return undefined;
    if (field.read !== undefined) {
      if (adapter.readAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: field.read.slotName,
        value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.readAdapterName),
      }));
    }
    if (field.write !== undefined) {
      if (adapter.writeAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: field.write.slotName,
        value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.writeAdapterName),
      }));
    }
  }
  for (const conversion of view.view.conversions) {
    const targetView = dispatch.views.find((candidate) =>
      candidate.view.definition === conversion.target);
    if (targetView === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: conversion.slotName,
      value: mojoProjectStaticMember(dispatch.concrete.targetType, targetView.conversionAdapterName),
    }));
  }
  return Object.freeze({
    kind: "construct",
    type: view.viewType,
    arguments: Object.freeze(arguments_),
  });
}

function planViewFactory(
  dispatch: MojoProjectConcreteDispatch,
  view: MojoProjectConcreteViewDispatch,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  registerMojoTypeImports(view.viewType, context);
  registerMojoTypeImports(mojoProjectObjectType, context);
  const construction = mojoConcreteViewConstruction(
    dispatch,
    view,
    Object.freeze({ kind: "path", path: "object" }),
  );
  if (construction === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: view.conversionAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "object",
      type: mojoProjectObjectType,
      convention: "imm",
    })]),
    resultType: view.viewType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: construction,
    })]),
  });
}

function planCallableAdapter(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const owner = context.program.projectRelationships.definitionForType(adapter.implementationOwnerType);
  const ownerView = owner === undefined
    ? undefined
    : dispatch.views.find((candidate) => candidate.view.definition === owner);
  if (ownerView === undefined) return undefined;
  const parameters = adapter.parameters.map((parameter) =>
    implementationParameter(parameter));
  const object: MojoExpression = Object.freeze({ kind: "path", path: "object" });
  const receiver: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(dispatch.concrete.targetType, ownerView.conversionAdapterName),
    arguments: Object.freeze([Object.freeze({ value: object })]),
  });
  const arguments_ = adapter.parameters.map((parameter, index): MojoCallArgument | undefined => {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.name });
    const converted = applyMojoConversion(value, adapter.argumentConversions[index], context);
    const implementationParameter = adapter.implementationParameters[index];
    if (converted === undefined || implementationParameter === undefined) return undefined;
    return Object.freeze({
      value: implementationParameter.disposition.kind === "owned" ||
          implementationParameter.disposition.kind === "immutable" &&
            implementationParameter.disposition.localCopy
        ? consumeMojoValue(converted, implementationParameter.callType, context.program.lifecycle)
        : converted,
    });
  });
  if (arguments_.some((argument) => argument === undefined)) return undefined;
  let call: MojoExpression = Object.freeze({
    kind: "method-call",
    receiver,
    name: adapter.implementationName,
    ...(adapter.genericArguments.length === 0
      ? {}
      : { genericArguments: adapter.genericArguments }),
    arguments: Object.freeze(arguments_ as MojoCallArgument[]),
  });
  if (adapter.variant.contract.asynchronous) {
    call = Object.freeze({ kind: "await", expression: call });
  }
  const convertedCall = applyMojoConversion(call, adapter.resultConversion, context);
  if (convertedCall === undefined) return undefined;
  const statement: MojoStatement = adapter.resultType.kind === "unit"
    ? Object.freeze({ kind: "expression", expression: call })
    : Object.freeze({ kind: "return", expression: convertedCall });
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "object", type: mojoProjectObjectType, convention: "imm" }),
      ...parameters,
    ]),
    resultType: adapter.resultType,
    asynchronous: adapter.variant.contract.asynchronous,
    raises: adapter.variant.contract.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([statement]),
  });
}

function planFieldAdapterMethods(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectDispatchFieldAdapter,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  if (adapter.kind === "stored") return planStoredFieldAdapters(dispatch, adapter, context);
  const methods: MojoFunctionDeclaration[] = [];
  const owner = context.program.projectRelationships.definitionForType(adapter.implementationOwnerType);
  const ownerView = owner === undefined
    ? undefined
    : dispatch.views.find((candidate) => candidate.view.definition === owner);
  if (ownerView === undefined) return undefined;
  const receiver: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(dispatch.concrete.targetType, ownerView.conversionAdapterName),
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({ kind: "path", path: "object" }),
    })]),
  });
  if (adapter.field.read !== undefined && adapter.readAdapterName !== undefined &&
    adapter.readImplementation !== undefined) {
    const name = context.program.projectDispatch.implementationName(
      adapter.readImplementation.declaration,
    );
    if (name === undefined) return undefined;
    let call: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver,
      name,
      arguments: Object.freeze([]),
    });
    if (adapter.field.read.slotType.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    const result = applyMojoConversion(call, adapter.readResultConversion, context);
    if (result === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.readAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([Object.freeze({ name: "object", type: mojoProjectObjectType })]),
      resultType: adapter.readType!,
      asynchronous: adapter.field.read.slotType.asynchronous,
      raises: adapter.field.read.slotType.raises,
      ...(adapter.field.read.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.read.slotType.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({ kind: "return", expression: result })]),
    }));
  }
  if (adapter.field.write !== undefined && adapter.writeAdapterName !== undefined &&
    adapter.writeImplementation !== undefined) {
    const name = context.program.projectDispatch.implementationName(
      adapter.writeImplementation.declaration,
    );
    if (name === undefined) return undefined;
    const value: MojoExpression = Object.freeze({ kind: "path", path: "value" });
    const converted = applyMojoConversion(value, adapter.writeValueConversion, context);
    if (converted === undefined || adapter.writeImplementationParameter === undefined) return undefined;
    const argument = adapter.writeImplementationParameter.disposition.kind === "owned"
      ? consumeMojoValue(
          converted,
          adapter.writeImplementationParameter.callType,
          context.program.lifecycle,
        )
      : converted;
    let call: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver,
      name,
      arguments: Object.freeze([Object.freeze({ value: argument })]),
    });
    if (adapter.field.write.slotType.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.writeAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "object", type: mojoProjectObjectType }),
        Object.freeze({
          name: "value",
          type: adapter.writeType!,
          convention: adapter.field.write.disposition === undefined
            ? "imm"
            : mojoParameterConvention(adapter.field.write.disposition),
        }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: adapter.field.write.slotType.asynchronous,
      raises: adapter.field.write.slotType.raises,
      ...(adapter.field.write.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.write.slotType.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({ kind: "expression", expression: call })]),
    }));
  }
  return Object.freeze(methods);
}

function planStoredFieldAdapters(
  dispatch: MojoProjectConcreteDispatch,
  adapter: Extract<MojoProjectDispatchFieldAdapter, { readonly kind: "stored" }>,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const stateType = mojoProjectStateType(dispatch.concrete);
  if (stateType === undefined) return undefined;
  registerMojoTypeImports(stateType, context);
  const object: MojoExpression = Object.freeze({ kind: "path", path: "object" });
  const storage = mojoMemberPath(mojoProjectObjectState(object, stateType), adapter.statePath);
  const methods: MojoFunctionDeclaration[] = [];
  if (adapter.field.read !== undefined && adapter.readAdapterName !== undefined) {
    const result = applyMojoConversion(storage, adapter.readResultConversion, context);
    if (result === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.readAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([Object.freeze({ name: "object", type: mojoProjectObjectType })]),
      resultType: adapter.readType!,
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({ kind: "return", expression: result })]),
    }));
  }
  if (adapter.field.write !== undefined && adapter.writeAdapterName !== undefined) {
    const value = applyMojoConversion(
      Object.freeze({ kind: "path", path: "value" }),
      adapter.writeValueConversion,
      context,
    );
    if (value === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.writeAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "object", type: mojoProjectObjectType }),
        Object.freeze({ name: "value", type: adapter.writeType! }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: storage,
        right: value,
      })]),
    }));
  }
  return Object.freeze(methods);
}

function implementationParameter(parameter: MojoAnalyzedParameter): MojoParameter {
  return Object.freeze({
    name: parameter.name,
    type: parameter.bodyType,
    convention: parameter.disposition.kind === "immutable" && parameter.disposition.localCopy
      ? "var"
      : mojoParameterConvention(parameter.disposition),
  });
}
