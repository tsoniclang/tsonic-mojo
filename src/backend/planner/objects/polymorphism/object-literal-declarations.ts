import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedFunction,
  MojoCallableExpressionSelection,
  MojoProjectObjectLiteralDispatch,
  MojoProjectObjectLiteralViewDispatch,
} from "../../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFieldDeclaration,
  MojoFunctionDeclaration,
  MojoStructDeclaration,
} from "../../../target-ast/index.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../../target-ast/index.js";
import {
  withMojoBindingOverrides,
  withMojoDeferredExecution,
  withMojoErrorType,
  withMojoLocalNameScope,
  withMojoSelfType,
} from "../../program/context.js";
import type {
  MojoBindingPlanOverride,
  MojoPlanningContext,
} from "../../program/context.js";
import {
  planLocationParameterPrelude,
  planMojoFunctionBody,
} from "../../declarations/project.js";
import { planMojoGenericParameters } from "../../declarations/generic-parameters.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "../../declarations/parameters.js";
import { planMojoValue } from "../../expressions/value.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStaticMember,
} from "./types.js";
import { planMojoIndexAdapterMethods } from "./index-adapters.js";
import {
  planObjectCallableAdapter,
  planObjectMethodPropertyAdapters,
} from "./object-literal-method-adapters.js";
import {
  planObjectDowncastAdapter,
  planObjectFieldAdapters,
} from "./object-literal-field-adapters.js";
import {
  allocateLocalName,
  objectStateFields,
  sameTargetType,
} from "./object-literal-support.js";

export function planObjectStateDeclarations(
  dispatch: MojoProjectObjectLiteralDispatch,
  stateName: string,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoStructDeclaration | undefined {
  const stateFields = objectStateFields(dispatch);
  const fields: MojoFieldDeclaration[] = [];
  for (const adapter of stateFields.stored) {
    registerMojoTypeImports(adapter.storageType, context);
    fields.push(Object.freeze({ name: adapter.stateName, type: adapter.storageType, compileTime: false }));
  }
  for (const storage of stateFields.methods) {
    const type = storage.storageType;
    registerMojoTypeImports(type, context);
    fields.push(Object.freeze({ name: storage.name, type, compileTime: false }));
  }
  for (const entry of stateFields.indexes) {
    registerMojoTypeImports(entry.type, context);
    fields.push(Object.freeze({ name: entry.name, type: entry.type, compileTime: false }));
  }
  for (const capture of dispatch.captures) {
    registerMojoTypeImports(capture.storageType, context);
    fields.push(Object.freeze({
      name: capture.stateName,
      type: capture.storageType,
      compileTime: false,
    }));
  }
  const implementationNames = new Map<MojoCallableExpressionSelection, string>();
  const usedNames = new Set(fields.map((field) => field.name));
  for (const view of dispatch.views) {
    for (const adapter of view.callableAdapters) {
      if (adapter.implementation !== undefined && !implementationNames.has(adapter.implementation)) {
        implementationNames.set(
          adapter.implementation,
          allocateLocalName(usedNames, `_implement_${adapter.variant.name}`),
        );
      }
    }
    for (const adapter of view.fieldAdapters) {
      if (adapter.kind !== "accessor") continue;
      for (const implementation of [adapter.readImplementation, adapter.writeImplementation]) {
        if (implementation !== undefined && !implementationNames.has(implementation)) {
          implementationNames.set(
            implementation,
            allocateLocalName(usedNames, `_implement_${adapter.field.property.sourceName}`),
          );
        }
      }
    }
  }
  const root = dispatch.views.find((view) =>
    sameTargetType(view.viewType, dispatch.selection.constructionType));
  if (root === undefined) return undefined;
  const methods: MojoFunctionDeclaration[] = [];
  for (const [implementation, name] of implementationNames) {
    const planned = planObjectImplementation(
      dispatch,
      implementation,
      name,
      root,
      stateType,
      context,
    );
    if (planned === undefined) return undefined;
    methods.push(planned);
  }
  for (const view of dispatch.views) {
    const factory = planObjectViewFactory(dispatch, view, stateType);
    if (factory === undefined) return undefined;
    methods.push(factory);
    for (const adapter of view.callableAdapters) {
      const implementationName = adapter.implementation === undefined
        ? undefined
        : implementationNames.get(adapter.implementation);
      if (adapter.implementation !== undefined) {
        const planned = implementationName === undefined
          ? undefined
          : planObjectCallableAdapter(adapter, implementationName, stateType, context);
        if (planned === undefined) return undefined;
        methods.push(planned);
      }
      const propertyAdapters = planObjectMethodPropertyAdapters(
        adapter,
        implementationName,
        stateType,
        context,
      );
      if (propertyAdapters === undefined) return undefined;
      methods.push(...propertyAdapters);
    }
    for (const adapter of view.fieldAdapters) {
      const planned = planObjectFieldAdapters(
        adapter,
        implementationNames,
        stateType,
        context,
      );
      if (planned === undefined) return undefined;
      methods.push(...planned);
    }
    for (const adapter of view.indexAdapters) {
      const planned = planMojoIndexAdapterMethods(adapter, stateType, "_object", context);
      if (planned === undefined) return undefined;
      methods.push(...planned);
    }
    for (const adapter of view.downcastAdapters) {
      methods.push(planObjectDowncastAdapter(adapter, context));
    }
  }
  return Object.freeze({
    kind: "struct",
    name: stateName,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze(fields),
    methods: Object.freeze(methods),
    decorators: mojoFieldwiseInitDecorators,
  });
}

function planObjectImplementation(
  dispatch: MojoProjectObjectLiteralDispatch,
  implementation: MojoCallableExpressionSelection,
  name: string,
  root: MojoProjectObjectLiteralViewDispatch,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const objectName = "_object";
  const object: MojoExpression = Object.freeze({ kind: "path", path: objectName });
  const state = mojoProjectObjectState(object, stateType);
  const overrides = new Map<Node, MojoBindingPlanOverride>();
  for (const capture of dispatch.captures) {
    overrides.set(capture.capture.declaration, Object.freeze({
      expression: Object.freeze({ kind: "member", receiver: state, name: capture.stateName }),
      storage: capture.capture.storage,
    }));
  }
  const self: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, root.factoryName),
    arguments: Object.freeze([Object.freeze({ value: object })]),
  });
  const implementationContext = withMojoSelfType(
    withMojoErrorType(
      withMojoBindingOverrides(
        withMojoDeferredExecution(withMojoLocalNameScope(context)),
        overrides,
      ),
      implementation.errorType,
    ),
    dispatch.selection.constructionType,
    self,
  );
  const parameters = implementation.parameters.map((parameter) =>
    planMojoParameterDeclaration(parameter, implementationContext));
  const prelude = planMojoParameterPrelude(
    implementation.parameters,
    implementationContext,
    planMojoValue,
    true,
  );
  if (prelude === undefined) return undefined;
  const function_: MojoAnalyzedFunction = Object.freeze({
    kind: implementation.kind,
    declaration: implementation.expression,
    sourceFile: implementation.sourceFile,
    name,
    typeParameters: implementation.typeParameters,
    parameters: implementation.parameters,
    resultType: implementation.resultType,
    body: implementation.body,
    asynchronous: implementation.asynchronous,
    raises: implementation.raises,
    ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
    ...(implementation.owner === undefined ? {} : { owner: implementation.owner }),
  });
  const body = planMojoFunctionBody(function_, implementationContext);
  if (body === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name,
    genericParameters: planMojoGenericParameters(function_),
    parameters: Object.freeze([
      Object.freeze({ name: objectName, type: mojoProjectObjectType, convention: "imm" }),
      ...parameters,
    ]),
    resultType: implementation.resultType,
    asynchronous: implementation.asynchronous,
    raises: implementation.raises,
    ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([
      ...prelude,
      ...planLocationParameterPrelude(function_, implementationContext),
      ...body,
    ]),
  });
}

function planObjectViewFactory(
  dispatch: MojoProjectObjectLiteralDispatch,
  view: MojoProjectObjectLiteralViewDispatch,
  stateType: MojoTargetTypeRef,
): MojoFunctionDeclaration | undefined {
  const object: MojoExpression = Object.freeze({ kind: "path", path: "_object" });
  const arguments_: MojoCallArgument[] = [Object.freeze({ name: "_object", value: object })];
  for (const variant of view.view.callables) {
    const adapter = view.callableAdapters.find((candidate) => candidate.variant === variant);
    if (adapter === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: variant.slotName,
      value: mojoProjectStaticMember(
        stateType,
        adapter.methodCallAdapterName ?? adapter.adapterName,
      ),
    }));
    if (variant.property?.read !== undefined) {
      if (adapter.methodReadAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: variant.property.read.slotName,
        value: mojoProjectStaticMember(stateType, adapter.methodReadAdapterName),
      }));
    }
    if (variant.property?.write !== undefined) {
      if (adapter.methodWriteAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: variant.property.write.slotName,
        value: mojoProjectStaticMember(stateType, adapter.methodWriteAdapterName),
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
        value: mojoProjectStaticMember(stateType, adapter.readAdapterName),
      }));
    }
    if (field.write !== undefined) {
      if (adapter.writeAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: field.write.slotName,
        value: mojoProjectStaticMember(stateType, adapter.writeAdapterName),
      }));
    }
  }
  for (const index of view.view.indexes) {
    const adapter = view.indexAdapters.find((candidate) => candidate.index === index);
    if (adapter === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: index.read.slotName,
      value: mojoProjectStaticMember(stateType, adapter.readAdapterName),
    }));
    if (index.write !== undefined) {
      if (adapter.writeAdapterName === undefined) return undefined;
      arguments_.push(Object.freeze({
        name: index.write.slotName,
        value: mojoProjectStaticMember(stateType, adapter.writeAdapterName),
      }));
    }
    arguments_.push(Object.freeze({
      name: index.copy.slotName,
      value: mojoProjectStaticMember(stateType, adapter.copyAdapterName),
    }));
  }
  for (const downcast of view.view.downcasts) {
    const adapter = view.downcastAdapters.find((candidate) => candidate.route === downcast);
    if (adapter === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: downcast.slotName,
      value: mojoProjectStaticMember(stateType, adapter.adapterName),
    }));
  }
  for (const conversion of view.view.conversions) {
    const target = dispatch.views.find((candidate) =>
      candidate.view.definition === conversion.target);
    if (target === undefined) return undefined;
    arguments_.push(Object.freeze({
      name: conversion.slotName,
      value: mojoProjectStaticMember(stateType, target.factoryName),
    }));
  }
  return Object.freeze({
    kind: "function",
    name: view.factoryName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
      type: mojoProjectObjectType,
      convention: "imm",
    })]),
    resultType: view.viewType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "construct",
        type: view.viewType,
        arguments: Object.freeze(arguments_),
      }),
    })]),
  });
}


