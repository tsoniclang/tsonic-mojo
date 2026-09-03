import type {
  MojoAnalyzedParameter,
  MojoProjectConcreteDispatch,
  MojoProjectConcreteViewDispatch,
  MojoProjectDispatchFieldAdapter,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
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
import { mojoModuleMemberExpression } from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoMemberPath,
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStateType,
  mojoProjectStaticMember,
} from "./types.js";
import { planMojoIndexAdapterMethods } from "./index-adapters.js";

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
      const methodAdapters = planMethodPropertyAdapters(dispatch, adapter, context);
      if (methodAdapters === undefined) return undefined;
      methods.push(...methodAdapters);
    }
    for (const adapter of view.fieldAdapters) {
      const planned = planFieldAdapterMethods(dispatch, adapter, context);
      if (planned === undefined) return undefined;
      methods.push(...planned);
    }
    for (const adapter of view.indexAdapters) {
      const stateType = mojoProjectStateType(dispatch.concrete);
      const planned = stateType === undefined
        ? undefined
        : planMojoIndexAdapterMethods(adapter, stateType, "object", context);
      if (planned === undefined) return undefined;
      methods.push(...planned);
    }
    for (const adapter of view.downcastAdapters) {
      const planned = planDowncastAdapter(dispatch, adapter, context);
      if (planned === undefined) return undefined;
      methods.push(planned);
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
      value: mojoProjectStaticMember(
        dispatch.concrete.targetType,
        adapter.methodCallAdapterName ?? adapter.adapterName,
      ),
    }));
    if (variant.property?.read !== undefined) {
      if (adapter.methodReadAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: variant.property.read.slotName,
        value: mojoProjectStaticMember(
          dispatch.concrete.targetType,
          adapter.methodReadAdapterName,
        ),
      }));
    }
    if (variant.property?.write !== undefined) {
      if (adapter.methodWriteAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: variant.property.write.slotName,
        value: mojoProjectStaticMember(
          dispatch.concrete.targetType,
          adapter.methodWriteAdapterName,
        ),
      }));
    }
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
  for (const index of view.view.indexes) {
    const adapter = view.indexAdapters.find((candidate) => candidate.index === index);
    if (adapter === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: index.read.slotName,
      value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.readAdapterName),
    }));
    if (index.write !== undefined) {
      if (adapter.writeAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: index.write.slotName,
        value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.writeAdapterName),
      }));
    }
    arguments_.push(Object.freeze({
      name: index.copy.slotName,
      value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.copyAdapterName),
    }));
  }
  for (const downcast of view.view.downcasts) {
    const adapter = view.downcastAdapters.find((candidate) => candidate.route === downcast);
    if (adapter === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: downcast.slotName,
      value: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.adapterName),
    }));
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

function planMethodPropertyAdapters(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const property = adapter.variant.property;
  if (property === undefined && adapter.methodStorage === undefined) return Object.freeze([]);
  const stateType = mojoProjectStateType(dispatch.concrete);
  if (stateType === undefined || adapter.variant.contract.asynchronous) return undefined;
  const methods: MojoFunctionDeclaration[] = [];
  if (adapter.methodCallAdapterName !== undefined && adapter.methodStorage !== undefined) {
    const override = methodStorageExpression(stateType, adapter.methodStorage.name);
    const overrideCall = erasedMethodCall(override, adapter, context);
    const directCall = directMethodAdapterCall(dispatch, adapter, context);
    if (overrideCall === undefined || directCall === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.methodCallAdapterName,
      genericParameters: Object.freeze([]),
      parameters: methodAdapterParameters(adapter),
      resultType: adapter.resultType,
      asynchronous: false,
      raises: adapter.variant.contract.raises,
      ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "if",
        condition: override,
        thenStatements: Object.freeze([methodCallStatement(overrideCall, adapter.resultType)]),
        elseStatements: Object.freeze([methodCallStatement(directCall, adapter.resultType)]),
      })]),
    }));
  }
  if (property?.read !== undefined) {
    if (adapter.methodBindAdapterName === undefined || adapter.methodReadAdapterName === undefined) {
      return undefined;
    }
    const bindingAdapter = planMethodBindingAdapter(dispatch, adapter, context);
    const readAdapter = planMethodReadAdapter(dispatch, adapter, stateType, context);
    if (bindingAdapter === undefined || readAdapter === undefined) return undefined;
    methods.push(bindingAdapter, readAdapter);
  }
  if (property?.write !== undefined) {
    if (adapter.methodWriteAdapterName === undefined || adapter.methodStorage === undefined) {
      return undefined;
    }
    const callableType = adapter.methodStorage.callableType;
    const optionalType: MojoTargetTypeRef = Object.freeze({ kind: "optional", value: callableType });
    registerMojoTypeImports(optionalType, context);
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.methodWriteAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "object", type: mojoProjectObjectType, convention: "imm" }),
        Object.freeze({ name: "value", type: callableType, convention: "imm" }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: methodStorageExpression(stateType, adapter.methodStorage.name),
        right: Object.freeze({
          kind: "construct",
          type: optionalType,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "path", path: "value" }),
          })]),
        }),
      })]),
    }));
  }
  return Object.freeze(methods);
}

function planMethodBindingAdapter(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.methodBindAdapterName === undefined || adapter.variant.property === undefined) {
    return undefined;
  }
  const callableType = adapter.variant.property.callableType;
  const argumentsType: MojoTargetTypeRef = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(callableType.parameters.map((parameter) => parameter.type)),
  });
  registerMojoTypeImports(argumentsType, context);
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "object" }),
  })];
  for (const [index, parameter] of adapter.parameters.entries()) {
    const value: MojoExpression = Object.freeze({
      kind: "element",
      receiver: Object.freeze({ kind: "path", path: "arguments" }),
      index: Object.freeze({ kind: "number-literal", text: String(index) }),
    });
    arguments_.push(Object.freeze({
      value: parameter.disposition.kind === "owned"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    }));
  }
  const call: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.adapterName),
    arguments: Object.freeze(arguments_),
  });
  return Object.freeze({
    kind: "function",
    name: adapter.methodBindAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "object", type: mojoProjectObjectType, convention: "imm" }),
      Object.freeze({ name: "arguments", type: argumentsType, convention: "var" }),
    ]),
    resultType: adapter.resultType,
    asynchronous: false,
    raises: adapter.variant.contract.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([methodCallStatement(call, adapter.resultType)]),
  });
}

function planMethodReadAdapter(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const property = adapter.variant.property;
  if (property?.read === undefined || adapter.methodReadAdapterName === undefined ||
    adapter.methodBindAdapterName === undefined) return undefined;
  registerMojoTypeImports(property.callableType, context);
  const object: MojoExpression = Object.freeze({ kind: "path", path: "object" });
  const bound: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(
      context,
      ["tsonic_runtime"],
      property.callableType.raises
        ? "bind_raising_project_callable"
        : "bind_project_callable",
    ),
    arguments: Object.freeze([
      Object.freeze({ value: object }),
      Object.freeze({
        value: mojoProjectStaticMember(
          dispatch.concrete.targetType,
          adapter.methodBindAdapterName,
        ),
      }),
    ]),
  });
  const statements: MojoStatement[] = [];
  if (adapter.methodStorage !== undefined) {
    const override = methodStorageExpression(stateType, adapter.methodStorage.name);
    statements.push(Object.freeze({
      kind: "if",
      condition: override,
      thenStatements: Object.freeze([Object.freeze({
        kind: "return",
        expression: Object.freeze({
          kind: "method-call",
          receiver: override,
          name: "value",
          arguments: Object.freeze([]),
        }),
      })]),
    }));
  }
  statements.push(Object.freeze({ kind: "return", expression: bound }));
  return Object.freeze({
    kind: "function",
    name: adapter.methodReadAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "object",
      type: mojoProjectObjectType,
      convention: "imm",
    })]),
    resultType: property.callableType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze(statements),
  });
}

function methodAdapterParameters(
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
): readonly MojoParameter[] {
  return Object.freeze([
    Object.freeze({ name: "object", type: mojoProjectObjectType, convention: "imm" }),
    ...adapter.parameters.map(implementationParameter),
  ]);
}

function directMethodAdapterCall(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "object" }),
  })];
  for (const parameter of adapter.parameters) {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.name });
    arguments_.push(Object.freeze({
      value: parameter.disposition.kind === "owned"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    }));
  }
  return Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(dispatch.concrete.targetType, adapter.adapterName),
    arguments: Object.freeze(arguments_),
  });
}

function erasedMethodCall(
  optional: MojoExpression,
  adapter: MojoProjectConcreteViewDispatch["callableAdapters"][number],
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (adapter.methodStorage === undefined) return undefined;
  const values = adapter.parameters.map((parameter): MojoExpression => {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.name });
    return parameter.disposition.kind === "owned"
      ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
      : value;
  });
  return Object.freeze({
    kind: "method-call",
    receiver: Object.freeze({
      kind: "method-call",
      receiver: optional,
      name: "value",
      arguments: Object.freeze([]),
    }),
    name: "call",
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({ kind: "tuple", elements: Object.freeze(values) }),
    })]),
  });
}

function methodCallStatement(
  call: MojoExpression,
  resultType: MojoTargetTypeRef,
): MojoStatement {
  return resultType.kind === "unit"
    ? Object.freeze({ kind: "expression", expression: call })
    : Object.freeze({ kind: "return", expression: call });
}

function methodStorageExpression(
  stateType: MojoTargetTypeRef,
  name: string,
): MojoExpression {
  return Object.freeze({
    kind: "member",
    receiver: mojoProjectObjectState(
      Object.freeze({ kind: "path", path: "object" }),
      stateType,
    ),
    name,
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

function planDowncastAdapter(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["downcastAdapters"][number],
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const resultType: MojoTargetTypeRef = Object.freeze({
    kind: "optional",
    value: adapter.route.targetType,
  });
  registerMojoTypeImports(resultType, context);
  const targetView = adapter.available
    ? dispatch.views.find((view) => view.view.definition === adapter.route.target)
    : undefined;
  if (adapter.available && targetView === undefined) return undefined;
  const value: MojoExpression = targetView === undefined
    ? Object.freeze({ kind: "construct", type: resultType, arguments: Object.freeze([]) })
    : Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "call",
            callee: mojoProjectStaticMember(
              dispatch.concrete.targetType,
              targetView.conversionAdapterName,
            ),
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({ kind: "path", path: "object" }),
            })]),
          }),
        })]),
      });
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "object",
      type: mojoProjectObjectType,
    })]),
    resultType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({ kind: "return", expression: value })]),
  });
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
