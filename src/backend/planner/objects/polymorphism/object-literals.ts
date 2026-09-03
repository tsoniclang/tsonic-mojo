import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedFunction,
  MojoCallableExpressionSelection,
  MojoProjectObjectLiteralCallableAdapter,
  MojoProjectObjectLiteralDispatch,
  MojoProjectObjectLiteralFieldAdapter,
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
    for (const entry of contribution.indexSignatures) {
      const destination = indexStorage.get(entry.indexSignature.declaration);
      if (destination === undefined) return undefined;
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_POLYMORPHIC_INDEX_SPREAD_NOT_SEALED",
        "A polymorphic object spread requires an exact index-signature dispatch plan.",
        contribution.element,
      );
      return undefined;
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
      if (!implementationNames.has(adapter.implementation)) {
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
      const implementationName = implementationNames.get(adapter.implementation);
      const planned = implementationName === undefined
        ? undefined
        : planObjectCallableAdapter(adapter, implementationName, stateType, context);
      if (planned === undefined) return undefined;
      methods.push(planned);
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
      value: mojoProjectStaticMember(stateType, adapter.adapterName),
    }));
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
  const parameters = adapter.parameters.map((parameter) =>
    planMojoParameterDeclaration(parameter, context));
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "_object" }),
  })];
  for (const [index, parameter] of adapter.parameters.entries()) {
    const implementationParameter = adapter.implementationParameters[index];
    const converted = applyMojoConversion(
      Object.freeze({ kind: "path", path: parameter.name }),
      adapter.argumentConversions[index],
      context,
    );
    if (implementationParameter === undefined || converted === undefined) return undefined;
    arguments_.push(Object.freeze({
      value: mojoParameterConvention(implementationParameter.disposition) === "var"
        ? consumeMojoValue(converted, implementationParameter.callType, context.program.lifecycle)
        : converted,
    }));
  }
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
    statements: Object.freeze([adapter.resultType.kind === "unit"
      ? Object.freeze({ kind: "expression", expression: call })
      : Object.freeze({ kind: "return", expression: result })]),
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

function objectStateFields(dispatch: MojoProjectObjectLiteralDispatch): {
  readonly stored: readonly Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>[];
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
  return Object.freeze({ stored, indexes: Object.freeze(indexes) });
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
