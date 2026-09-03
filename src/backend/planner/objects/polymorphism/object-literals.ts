import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedFunction,
  MojoCallableExpressionSelection,
  MojoProjectObjectLiteralCallableAdapter,
  MojoProjectObjectLiteralDispatch,
  MojoProjectObjectLiteralFieldAdapter,
  MojoProjectObjectLiteralMethodStorage,
  MojoProjectObjectLiteralViewDispatch,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../../target-model/types/equality.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFieldDeclaration,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoStatement,
  MojoStructDeclaration,
} from "../../../target-ast/index.js";
import {
  mojoFieldwiseInitDecorators,
  mojoStaticMethodDecorators,
} from "../../../target-ast/index.js";
import {
  allocateMojoSyntheticDeclarationName,
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
  withMojoBindingOverrides,
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
  planMojoGenericParameters,
} from "../../declarations/project.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "../../declarations/parameters.js";
import { planMojoValue } from "../../expressions/value.js";
import type { MojoValuePlanner } from "../../expressions/support.js";
import {
  applyMojoConversion,
  isTriviallyPureMojoValue,
  orderMojoValues,
} from "../../expressions/support.js";
import type { MojoValuePlan } from "../../expressions/value-plan.js";
import { consumeMojoValue, withMojoValue } from "../../expressions/value-plan.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import { planDictionaryKey } from "../../expressions/conditional-values.js";
import {
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStaticMember,
} from "./types.js";
import { planMojoIndexAdapterMethods } from "./index-adapters.js";
import { planMojoProjectDispatchArguments } from "./parameter-adapters.js";

export function planMojoPolymorphicObjectLiteral(
  node: Node,
  dispatch: MojoProjectObjectLiteralDispatch,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const stateName = allocateMojoSyntheticDeclarationName(context, "object_state");
  const stateType = localNamedType(context, stateName);
  const storedAdapters = uniqueStoredAdapters(dispatch);
  const indexStorage = new Map<Node, { readonly name: string; readonly type: MojoTargetTypeRef }>();
  const before: MojoStatement[] = [];
  const storedValues = new Map<string, MojoExpression>();
  const storedMethods = new Map<string, MojoExpression>();

  for (const { indexSignature, keyType, valueType } of dispatch.selection.indexSignatures) {
    const type: MojoTargetTypeRef = Object.freeze({ kind: "dictionary", key: keyType, value: valueType });
    const name = allocateMojoSyntheticName(context, "object_index");
    registerMojoTypeImports(type, context);
    before.push(Object.freeze({
      kind: "variable",
      name,
      type,
      initializer: Object.freeze({ kind: "dictionary", entries: Object.freeze([]) }),
    }));
    indexStorage.set(indexSignature.declaration, Object.freeze({ name, type }));
  }

  for (const contribution of dispatch.selection.contributions) {
    if (contribution.kind === "method" || contribution.kind === "getter" ||
      contribution.kind === "setter") continue;
    if (contribution.kind === "field") {
      const targets = storedAdapters.filter((adapter) =>
        propertyDeclarations(adapter.field.property).some((declaration) =>
          propertyDeclarations(contribution.field).includes(declaration)));
      const plan = planValue(contribution.value, context, contribution.fieldType);
      if (targets.length === 0 || plan === undefined) return undefined;
      before.push(...plan.before);
      const value = stabilize(
        plan.value,
        contribution.fieldType,
        "object_field",
        before,
        context,
      );
      for (const target of targets) storedValues.set(target.stateName, value);
      continue;
    }
    if (contribution.kind === "index-entry") {
      const storage = indexStorage.get(contribution.indexSignature.declaration);
      const key = planIndexKey(contribution.key, contribution.keyType, context, planValue);
      const value = planValue(contribution.value, context, contribution.valueType);
      if (storage === undefined || key === undefined || value === undefined) return undefined;
      const ordered = orderMojoValues(Object.freeze([
        Object.freeze({ plan: key, type: contribution.keyType, role: "object_index_key" }),
        Object.freeze({ plan: value, type: contribution.valueType, role: "object_index_value" }),
      ]), context, true);
      before.push(...ordered.before, Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({
          kind: "element",
          receiver: Object.freeze({ kind: "path", path: storage.name }),
          index: ordered.values[0]!,
        }),
        right: ordered.values[1]!,
      }));
      continue;
    }
    const spreadPlan = planValue(contribution.value, context, contribution.sourceType);
    if (spreadPlan === undefined) return undefined;
    before.push(...spreadPlan.before);
    const spread = stabilize(
      spreadPlan.value,
      contribution.sourceType,
      "object_spread",
      before,
      context,
    );
    const sourceView = dispatch.views.find((candidate) =>
      sameTargetType(candidate.viewType, contribution.sourceType));
    if (sourceView === undefined) return undefined;
    for (const adapter of storedAdapters) {
      const sourceField = sourceView.fieldAdapters.find((candidate) =>
        propertyDeclarations(candidate.field.property).some((declaration) =>
          propertyDeclarations(adapter.field.property).includes(declaration)));
      const readName = sourceField?.field.read?.name;
      if (readName === undefined) return undefined;
      const value: MojoExpression = Object.freeze({
        kind: "method-call",
        receiver: spread,
        name: readName,
        arguments: Object.freeze([]),
      });
      storedValues.set(
        adapter.stateName,
        stabilize(value, adapter.storageType, "spread_field", before, context),
      );
    }
    for (const storage of dispatch.methodStorages) {
      if (storage.initialization.kind !== "spread" ||
        storage.initialization.contribution !== contribution) continue;
      const variant = context.program.projectDispatch.callableFor(
        contribution.sourceType,
        storage.initialization.declaration,
        Object.freeze([]),
      );
      if (variant?.property?.read === undefined ||
        !mojoTargetTypeEquals(variant.property.callableType, storage.callableType)) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_OBJECT_SPREAD_METHOD_READ_NOT_SEALED",
          "Object spread has no exact bound-callable read slot for one selected project method.",
          contribution.element,
        );
        return undefined;
      }
      const optionalType = storage.storageType;
      registerMojoTypeImports(optionalType, context);
      storedMethods.set(storage.name, Object.freeze({
        kind: "construct",
        type: optionalType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "method-call",
            receiver: spread,
            name: variant.property.read.name,
            arguments: Object.freeze([]),
          }),
        })]),
      }));
    }
    for (const entry of contribution.indexSignatures) {
      const destination = indexStorage.get(entry.indexSignature.declaration);
      const sourceIndex = sourceView.indexAdapters.find((candidate) =>
        candidate.index.indexSignature.declaration === entry.indexSignature.declaration);
      if (destination === undefined || sourceIndex === undefined ||
        !mojoTargetTypeEquals(destination.type, sourceIndex.storageType)) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_POLYMORPHIC_INDEX_SPREAD_NOT_SEALED",
          "A polymorphic object spread has no exact index-signature copy dispatch plan.",
          contribution.element,
        );
        return undefined;
      }
      before.push(Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "method-call",
          receiver: spread,
          name: sourceIndex.index.copy.name,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "path", path: destination.name }),
          })]),
        }),
      }));
    }
  }

  for (const adapter of storedAdapters) {
    if (storedValues.has(adapter.stateName)) continue;
    const field = dispatch.selection.fields.find(({ field }) =>
      propertyDeclarations(adapter.field.property).includes(field.declaration));
    if (field?.field.optional !== true) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_OBJECT_REQUIRED_FIELD_PLAN_MISSING",
        "Polymorphic object construction has no sealed value for one required field.",
        node,
      );
      return undefined;
    }
    registerMojoTypeImports(adapter.storageType, context);
    storedValues.set(adapter.stateName, Object.freeze({
      kind: "construct",
      type: adapter.storageType,
      arguments: Object.freeze([]),
    }));
  }
  for (const storage of dispatch.methodStorages) {
    if (storedMethods.has(storage.name)) continue;
    if (storage.initialization.kind !== "default") return undefined;
    registerMojoTypeImports(storage.storageType, context);
    storedMethods.set(storage.name, Object.freeze({ kind: "none-literal" }));
  }

  const declarations = planObjectStateDeclarations(dispatch, stateName, stateType, context);
  if (declarations === undefined) return undefined;
  context.syntheticDeclarations.push(declarations);
  registerMojoTypeImports(mojoProjectObjectType, context);
  const stateFields = objectStateFields(dispatch);
  const stateArguments: MojoCallArgument[] = [];
  for (const field of stateFields.stored) {
    const value = storedValues.get(field.stateName);
    if (value === undefined) return undefined;
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(value, field.storageType, context.program.lifecycle),
    }));
  }
  for (const storage of stateFields.methods) {
    const value = storedMethods.get(storage.name);
    if (value === undefined) return undefined;
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(
        value,
        storage.storageType,
        context.program.lifecycle,
      ),
    }));
  }
  for (const entry of stateFields.indexes) {
    const storage = indexStorage.get(entry.declaration);
    if (storage === undefined) return undefined;
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(
        Object.freeze({ kind: "path", path: storage.name }),
        storage.type,
        context.program.lifecycle,
      ),
    }));
  }
  for (const capture of dispatch.captures) {
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(
        Object.freeze({ kind: "path", path: capture.capture.name }),
        capture.storageType,
        context.program.lifecycle,
      ),
    }));
  }
  const object: MojoExpression = Object.freeze({
    kind: "construct",
    type: mojoProjectObjectType,
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({
        kind: "construct",
        type: stateType,
        arguments: Object.freeze(stateArguments),
      }),
    })]),
  });
  const root = dispatch.views.find((view) =>
    sameTargetType(view.viewType, dispatch.selection.constructionType));
  if (root === undefined) return undefined;
  const constructed: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, root.factoryName),
    arguments: Object.freeze([Object.freeze({ value: object })]),
  });
  const converted = applyMojoConversion(
    constructed,
    dispatch.selection.resultConversion,
    context,
  );
  return converted === undefined ? undefined : withMojoValue(before, converted);
}

function planObjectStateDeclarations(
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
      withMojoBindingOverrides(withMojoLocalNameScope(context), overrides),
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

function planObjectCallableAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  implementationName: string,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.implementation === undefined) return undefined;
  const parameters = adapter.parameters.map((parameter) =>
    planMojoParameterDeclaration(parameter, context));
  const adapted = planMojoProjectDispatchArguments(adapter.parameterAdapters, context);
  if (adapted === undefined) return undefined;
  const arguments_: MojoCallArgument[] = [
    Object.freeze({ value: Object.freeze({ kind: "path", path: "_object" }) }),
    ...adapted.arguments,
  ];
  let call: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, implementationName),
    ...(adapter.genericArguments.length === 0
      ? {}
      : { genericArguments: adapter.genericArguments }),
    arguments: Object.freeze(arguments_),
  });
  if (adapter.implementation.asynchronous) {
    call = Object.freeze({ kind: "await", expression: call });
  }
  const result = applyMojoConversion(call, adapter.resultConversion, context);
  if (result === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
      ...parameters,
    ]),
    resultType: adapter.resultType,
    asynchronous: adapter.variant.contract.asynchronous,
    raises: adapter.variant.contract.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([
      ...adapted.before,
      adapter.resultType.kind === "unit"
        ? Object.freeze({ kind: "expression", expression: call })
        : Object.freeze({ kind: "return", expression: result }),
    ]),
  });
}

function planObjectMethodPropertyAdapters(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  implementationName: string | undefined,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const property = adapter.variant.property;
  const storage = adapter.methodStorage;
  if (property === undefined && storage === undefined) return Object.freeze([]);
  if (adapter.variant.contract.asynchronous) return undefined;
  const direct = implementationName === undefined
    ? undefined
    : objectDirectMethodCall(adapter, stateType, context);
  if (storage?.initialization.kind === "default" && direct === undefined) return undefined;
  const methods: MojoFunctionDeclaration[] = [];
  if (storage !== undefined) {
    if (adapter.methodCallAdapterName === undefined) return undefined;
    const stored = objectMethodStorageExpression(stateType, storage.name);
    const storedCall = objectErasedMethodCall(stored, adapter, context);
    if (storedCall === undefined) return undefined;
    const statements: MojoStatement[] = storage.initialization.kind === "spread"
      ? [objectMethodCallStatement(storedCall, adapter.resultType)]
      : direct === undefined
        ? []
        : [Object.freeze({
            kind: "if" as const,
            condition: stored,
            thenStatements: Object.freeze([
              objectMethodCallStatement(storedCall, adapter.resultType),
            ]),
            elseStatements: Object.freeze([
              objectMethodCallStatement(direct, adapter.resultType),
            ]),
          })];
    if (statements.length === 0) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.methodCallAdapterName,
      genericParameters: Object.freeze([]),
      parameters: objectMethodAdapterParameters(adapter, context),
      resultType: adapter.resultType,
      asynchronous: false,
      raises: adapter.variant.contract.raises,
      ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze(statements),
    }));
  }
  if (property?.read !== undefined) {
    if (adapter.methodReadAdapterName === undefined) return undefined;
    if (storage?.initialization.kind === "spread") {
      methods.push(objectSpreadMethodReadAdapter(adapter, stateType));
    } else {
      if (implementationName === undefined || adapter.methodBindAdapterName === undefined) {
        return undefined;
      }
      const binding = planObjectMethodBindingAdapter(adapter, stateType, context);
      const read = planObjectMethodReadAdapter(adapter, stateType, context);
      if (binding === undefined || read === undefined) return undefined;
      methods.push(binding, read);
    }
  }
  if (property?.write !== undefined) {
    if (storage === undefined || adapter.methodWriteAdapterName === undefined) return undefined;
    const optionalType = storage.storageType;
    registerMojoTypeImports(optionalType, context);
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.methodWriteAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
        Object.freeze({ name: "value", type: storage.callableType, convention: "imm" }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: objectMethodStorageExpression(stateType, storage.name),
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

function planObjectMethodBindingAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const property = adapter.variant.property;
  if (property === undefined || adapter.methodBindAdapterName === undefined) return undefined;
  const argumentsType: MojoTargetTypeRef = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(property.callableType.parameters.map((parameter) => parameter.type)),
  });
  registerMojoTypeImports(argumentsType, context);
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "_object" }),
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
    callee: mojoProjectStaticMember(stateType, adapter.adapterName),
    arguments: Object.freeze(arguments_),
  });
  return Object.freeze({
    kind: "function",
    name: adapter.methodBindAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
      Object.freeze({ name: "arguments", type: argumentsType, convention: "var" }),
    ]),
    resultType: adapter.resultType,
    asynchronous: false,
    raises: adapter.variant.contract.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([objectMethodCallStatement(call, adapter.resultType)]),
  });
}

function planObjectMethodReadAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const property = adapter.variant.property;
  if (property?.read === undefined || adapter.methodReadAdapterName === undefined ||
    adapter.methodBindAdapterName === undefined) return undefined;
  registerMojoTypeImports(property.callableType, context);
  const statements: MojoStatement[] = [];
  if (adapter.methodStorage !== undefined) {
    const stored = objectMethodStorageExpression(stateType, adapter.methodStorage.name);
    statements.push(Object.freeze({
      kind: "if",
      condition: stored,
      thenStatements: Object.freeze([Object.freeze({
        kind: "return",
        expression: Object.freeze({
          kind: "method-call",
          receiver: stored,
          name: "value",
          arguments: Object.freeze([]),
        }),
      })]),
    }));
  }
  statements.push(Object.freeze({
    kind: "return",
    expression: Object.freeze({
      kind: "call",
      callee: mojoModuleMemberExpression(
        context,
        ["tsonic_runtime"],
        property.callableType.raises
          ? "bind_raising_project_callable"
          : "bind_project_callable",
      ),
      arguments: Object.freeze([
        Object.freeze({ value: Object.freeze({ kind: "path", path: "_object" }) }),
        Object.freeze({ value: mojoProjectStaticMember(stateType, adapter.methodBindAdapterName) }),
      ]),
    }),
  }));
  return Object.freeze({
    kind: "function",
    name: adapter.methodReadAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
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

function objectSpreadMethodReadAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
): MojoFunctionDeclaration {
  const property = adapter.variant.property!;
  const storage = adapter.methodStorage!;
  return Object.freeze({
    kind: "function",
    name: adapter.methodReadAdapterName!,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
      type: mojoProjectObjectType,
      convention: "imm",
    })]),
    resultType: property.callableType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "method-call",
        receiver: objectMethodStorageExpression(stateType, storage.name),
        name: "value",
        arguments: Object.freeze([]),
      }),
    })]),
  });
}

function objectDirectMethodCall(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression {
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "_object" }),
  })];
  for (const parameter of adapter.parameters) {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.incomingName });
    arguments_.push(Object.freeze({
      value: parameter.disposition.kind === "owned"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    }));
  }
  return Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, adapter.adapterName),
    arguments: Object.freeze(arguments_),
  });
}

function objectErasedMethodCall(
  optional: MojoExpression,
  adapter: MojoProjectObjectLiteralCallableAdapter,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (adapter.methodStorage === undefined) return undefined;
  const values = adapter.parameters.map((parameter): MojoExpression => {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.incomingName });
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

function objectMethodAdapterParameters(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  context: MojoPlanningContext,
): readonly MojoParameter[] {
  return Object.freeze([
    Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
    ...adapter.parameters.map((parameter) => planMojoParameterDeclaration(parameter, context)),
  ]);
}

function objectMethodCallStatement(
  call: MojoExpression,
  resultType: MojoTargetTypeRef,
): MojoStatement {
  return resultType.kind === "unit"
    ? Object.freeze({ kind: "expression", expression: call })
    : Object.freeze({ kind: "return", expression: call });
}

function objectMethodStorageExpression(
  stateType: MojoTargetTypeRef,
  name: string,
): MojoExpression {
  return Object.freeze({
    kind: "member",
    receiver: mojoProjectObjectState(
      Object.freeze({ kind: "path", path: "_object" }),
      stateType,
    ),
    name,
  });
}

function planObjectFieldAdapters(
  adapter: MojoProjectObjectLiteralFieldAdapter,
  implementationNames: ReadonlyMap<MojoCallableExpressionSelection, string>,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const methods: MojoFunctionDeclaration[] = [];
  const object: MojoExpression = Object.freeze({ kind: "path", path: "_object" });
  const state = mojoProjectObjectState(object, stateType);
  if (adapter.kind === "stored") {
    const storage: MojoExpression = Object.freeze({
      kind: "member",
      receiver: state,
      name: adapter.stateName,
    });
    if (adapter.readAdapterName !== undefined && adapter.readType !== undefined &&
      adapter.readResultConversion !== undefined) {
      const value = applyMojoConversion(storage, adapter.readResultConversion, context);
      if (value === undefined) return undefined;
      methods.push(staticFieldAdapter(
        adapter.readAdapterName,
        Object.freeze([]),
        adapter.readType,
        Object.freeze({ kind: "return", expression: value }),
      ));
    }
    if (adapter.writeAdapterName !== undefined && adapter.writeType !== undefined &&
      adapter.writeValueConversion !== undefined) {
      const value = applyMojoConversion(
        Object.freeze({ kind: "path", path: "value" }),
        adapter.writeValueConversion,
        context,
      );
      if (value === undefined) return undefined;
      methods.push(staticFieldAdapter(
        adapter.writeAdapterName,
        Object.freeze([Object.freeze({
          name: "value",
          type: adapter.writeType,
          convention: adapter.field.write?.disposition === undefined
            ? "imm"
            : mojoParameterConvention(adapter.field.write.disposition),
        })]),
        Object.freeze({ kind: "unit" }),
        Object.freeze({ kind: "assignment", operator: "=", left: storage, right: value }),
      ));
    }
    return Object.freeze(methods);
  }
  if (adapter.readAdapterName !== undefined && adapter.readImplementation !== undefined &&
    adapter.readType !== undefined && adapter.readResultConversion !== undefined) {
    const name = implementationNames.get(adapter.readImplementation);
    if (name === undefined) return undefined;
    let call: MojoExpression = Object.freeze({
      kind: "call",
      callee: mojoProjectStaticMember(stateType, name),
      arguments: Object.freeze([Object.freeze({ value: object })]),
    });
    if (adapter.readImplementation.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    const result = applyMojoConversion(call, adapter.readResultConversion, context);
    if (result === undefined) return undefined;
    methods.push(Object.freeze({
      ...staticFieldAdapter(
        adapter.readAdapterName,
        Object.freeze([]),
        adapter.readType,
        Object.freeze({ kind: "return", expression: result }),
      ),
      asynchronous: adapter.readImplementation.asynchronous,
      raises: adapter.field.read?.slotType.raises === true,
      ...(adapter.field.read?.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.read.slotType.errorType }),
    }));
  }
  if (adapter.writeAdapterName !== undefined && adapter.writeImplementation !== undefined &&
    adapter.writeType !== undefined && adapter.writeValueConversion !== undefined) {
    const name = implementationNames.get(adapter.writeImplementation);
    const parameter = adapter.writeImplementation.parameters[0];
    const converted = applyMojoConversion(
      Object.freeze({ kind: "path", path: "value" }),
      adapter.writeValueConversion,
      context,
    );
    if (name === undefined || parameter === undefined || converted === undefined) return undefined;
    const argument = mojoParameterConvention(parameter.disposition) === "var"
      ? consumeMojoValue(converted, parameter.callType, context.program.lifecycle)
      : converted;
    let call: MojoExpression = Object.freeze({
      kind: "call",
      callee: mojoProjectStaticMember(stateType, name),
      arguments: Object.freeze([
        Object.freeze({ value: object }),
        Object.freeze({ value: argument }),
      ]),
    });
    if (adapter.writeImplementation.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    methods.push(Object.freeze({
      ...staticFieldAdapter(
        adapter.writeAdapterName,
        Object.freeze([Object.freeze({
          name: "value",
          type: adapter.writeType,
          convention: adapter.field.write?.disposition === undefined
            ? "imm"
            : mojoParameterConvention(adapter.field.write.disposition),
        })]),
        Object.freeze({ kind: "unit" }),
        Object.freeze({ kind: "expression", expression: call }),
      ),
      asynchronous: adapter.writeImplementation.asynchronous,
      raises: adapter.field.write?.slotType.raises === true,
      ...(adapter.field.write?.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.write.slotType.errorType }),
    }));
  }
  return Object.freeze(methods);
}

function staticFieldAdapter(
  name: string,
  parameters: readonly import("../../../target-ast/index.js").MojoParameter[],
  resultType: MojoTargetTypeRef,
  statement: MojoStatement,
): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
      ...parameters,
    ]),
    resultType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([statement]),
  });
}

function planObjectDowncastAdapter(
  adapter: MojoProjectObjectLiteralViewDispatch["downcastAdapters"][number],
  context: MojoPlanningContext,
): MojoFunctionDeclaration {
  const resultType: MojoTargetTypeRef = Object.freeze({
    kind: "optional",
    value: adapter.route.targetType,
  });
  registerMojoTypeImports(resultType, context);
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
      type: mojoProjectObjectType,
    })]),
    resultType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([]),
      }),
    })]),
  });
}

function objectStateFields(dispatch: MojoProjectObjectLiteralDispatch): {
  readonly stored: readonly Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>[];
  readonly methods: readonly MojoProjectObjectLiteralMethodStorage[];
  readonly indexes: readonly {
    readonly declaration: Node;
    readonly name: string;
    readonly type: MojoTargetTypeRef;
  }[];
} {
  const stored = uniqueStoredAdapters(dispatch);
  const indexes = dispatch.selection.indexSignatures.map(({ indexSignature, keyType, valueType }) =>
    Object.freeze({
      declaration: indexSignature.declaration,
      name: indexSignature.storageName,
      type: Object.freeze({ kind: "dictionary" as const, key: keyType, value: valueType }),
    }));
  return Object.freeze({
    stored,
    methods: dispatch.methodStorages,
    indexes: Object.freeze(indexes),
  });
}

function uniqueStoredAdapters(
  dispatch: MojoProjectObjectLiteralDispatch,
): readonly Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>[] {
  const byName = new Map<string, Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>>();
  for (const view of dispatch.views) {
    for (const adapter of view.fieldAdapters) {
      if (adapter.kind === "stored" && !byName.has(adapter.stateName)) {
        byName.set(adapter.stateName, adapter);
      }
    }
  }
  return Object.freeze([...byName.values()]);
}

function propertyDeclarations(
  property: import("../../../../analysis/program/model.js").MojoProjectDispatchField["property"],
): readonly Node[] {
  return property.kind === "accessor-property" ? property.declarations : [property.declaration];
}

function planIndexKey(
  key: Extract<import("../../../../analysis/program/model.js").MojoObjectLiteralContribution, {
    readonly kind: "index-entry";
  }>["key"],
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  if (key.kind === "expression") return planValue(key.expression, context, type);
  const value = key.literalKind === "string"
    ? planDictionaryKey(key.value, type, context)
    : Object.freeze({ kind: "number-literal" as const, text: key.value });
  return value === undefined ? undefined : withMojoValue(Object.freeze([]), value);
}

function stabilize(
  value: MojoExpression,
  type: MojoTargetTypeRef,
  role: string,
  before: MojoStatement[],
  context: MojoPlanningContext,
): MojoExpression {
  registerMojoTypeImports(type, context);
  if (isTriviallyPureMojoValue(value)) return value;
  const name = allocateMojoSyntheticName(context, role);
  before.push(Object.freeze({ kind: "variable", name, type, initializer: value }));
  return Object.freeze({ kind: "path", path: name });
}

function localNamedType(context: MojoPlanningContext, name: string): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: `tsonic.mojo.generated.${context.module.modulePath.join(".")}.${name}`,
    modulePath: context.module.modulePath,
    name,
  });
}

function allocateLocalName(names: Set<string>, requested: string): string {
  let candidate = requested;
  let suffix = 2;
  while (names.has(candidate)) candidate = `${requested}_${suffix++}`;
  names.add(candidate);
  return candidate;
}

function sameTargetType(left: MojoTargetTypeRef, right: MojoTargetTypeRef): boolean {
  return mojoTargetTypeEquals(left, right);
}
