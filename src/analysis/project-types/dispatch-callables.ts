import type { Node } from "@tsonic/tsts";
import { mojoParameterConvention } from "../representations/index.js";
import type {
  MojoAnalyzedAccessorProperty,
  MojoAnalyzedCallableSignature,
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
  MojoAnalyzedParameter,
  MojoProjectConcreteDispatch,
  MojoProjectDispatchCallableVariant,
  MojoProjectDispatchMethodProperty,
  MojoProjectDispatchView,
  MojoProjectObjectLiteralDispatch,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
} from "../program/model.js";
import type {
  MojoProjectTypeDefinition,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import {
  mojoTargetGenericArgumentsEqual,
  mojoTargetTypeEquals,
} from "../../target-model/types/equality.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoSourceCallableSpecializationPlan } from "../callables/specializations.js";

import {
  allocateName,
  callableSubstitutions,
  functionType,
  projectObjectType,
  substituteParameter,
} from "./dispatch-support.js";

export interface MethodPropertyUsage {
  readonly declaration: Node;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly callableTypes: readonly Extract<MojoTargetTypeRef, { readonly kind: "callable" }>[];
}

export function collectMethodPropertyUsages(
  nodes: ReadonlySet<Node>,
  selections: WeakMap<Node, MojoPropertySelection>,
  objectLiteralNodes: ReadonlySet<Node>,
  objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>,
  issues: { readonly node: Node; readonly code: string; readonly message: string }[],
): ReadonlyMap<Node, MethodPropertyUsage> {
  const pending = new Map<Node, {
    readable: boolean;
    writable: boolean;
    callableTypes: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>[];
  }>();
  const merge = (
    declaration: Node,
    readable: boolean,
    writable: boolean,
    callableType?: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  ): void => {
    const usage = pending.get(declaration) ?? {
      readable: false,
      writable: false,
      callableTypes: [],
    };
    usage.readable ||= readable;
    usage.writable ||= writable;
    if (callableType !== undefined && !usage.callableTypes.some((candidate) =>
      mojoTargetTypeEquals(candidate, callableType))) {
      usage.callableTypes.push(callableType);
    }
    pending.set(declaration, usage);
  };
  for (const node of nodes) {
    const selection = selections.get(node);
    if (selection?.kind !== "project-method") continue;
    merge(
      selection.declaration,
      selection.accessMode === "read" || selection.accessMode === "read-write",
      selection.accessMode === "write" || selection.accessMode === "read-write",
      selection.callableType,
    );
  }
  for (const node of objectLiteralNodes) {
    const selection = objectLiteralSelections.get(node);
    if (selection?.kind !== "interface") continue;
    for (const contribution of selection.contributions) {
      if (contribution.kind !== "spread") continue;
      for (const { method } of contribution.methods) merge(method.declaration, true, false);
    }
  }
  return new Map([...pending].flatMap(([declaration, usage]) => {
    if (usage.callableTypes.length > 1) {
      issues.push(Object.freeze({
        node: declaration,
        code: "MOJO_PROJECT_METHOD_PROPERTY_ABI_CONFLICT",
        message: "One project method property is selected through incompatible exact callable ABIs.",
      }));
      return [];
    }
    return [[declaration, Object.freeze({
      declaration,
      readable: usage.readable,
      writable: usage.writable,
      callableTypes: Object.freeze([...usage.callableTypes]),
    })] as const];
  }));
}

export function collectImplementationMethodPropertyUsages(
  usages: ReadonlyMap<Node, MethodPropertyUsage>,
  classes: readonly MojoAnalyzedClass[],
  relationships: MojoProjectTypeRelationships,
): ReadonlyMap<Node, MethodPropertyUsage> {
  const result = new Map<Node, {
    declaration: Node;
    readable: boolean;
    writable: boolean;
    callableTypes: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>[];
  }>();
  const merge = (declaration: Node, usage: MethodPropertyUsage): void => {
    const current = result.get(declaration) ?? {
      declaration,
      readable: false,
      writable: false,
      callableTypes: [],
    };
    current.readable ||= usage.readable;
    current.writable ||= usage.writable;
    for (const callableType of usage.callableTypes) {
      if (!current.callableTypes.some((candidate) =>
        mojoTargetTypeEquals(candidate, callableType))) {
        current.callableTypes.push(callableType);
      }
    }
    result.set(declaration, current);
  };
  for (const usage of usages.values()) {
    merge(usage.declaration, usage);
    for (const class_ of classes) {
      const selected = relationships.memberImplementation(
        class_.definition,
        usage.declaration,
      );
      if (selected.kind === "resolved") {
        merge(selected.implementation.declaration, usage);
      }
    }
  }
  return new Map([...result].map(([declaration, usage]) => [declaration, Object.freeze({
    ...usage,
    callableTypes: Object.freeze([...usage.callableTypes]),
  })]));
}

export function createMethodProperty(
  callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  usage: MethodPropertyUsage,
  methodName: string,
  usedNames: Set<string>,
): MojoProjectDispatchMethodProperty {
  const readName = usage.readable
    ? allocateName(usedNames, `_read_${methodName}_method`)
    : undefined;
  const writeName = usage.writable
    ? allocateName(usedNames, `_write_${methodName}_method`)
    : undefined;
  return Object.freeze({
    callableType,
    ...(readName === undefined
      ? {}
      : {
          read: Object.freeze({
            name: readName,
            slotName: allocateName(usedNames, `_${readName}_dispatch`),
            slotType: functionType(
              [{ type: projectObjectType, convention: "imm", passing: "plain" }],
              callableType,
              false,
              false,
            ),
          }),
        }),
    ...(writeName === undefined
      ? {}
      : {
          write: Object.freeze({
            name: writeName,
            slotName: allocateName(usedNames, `_${writeName}_dispatch`),
            slotType: functionType([
              { type: projectObjectType, convention: "imm", passing: "plain" },
              { type: callableType, convention: "imm", passing: "plain" },
            ], Object.freeze({ kind: "unit" }), false, false),
          }),
        }),
  });
}

export function dispatchCallableType(
  contract: MojoAnalyzedCallableSignature,
  parameters: readonly MojoAnalyzedParameter[],
  resultType: MojoTargetTypeRef,
  errorType: MojoTargetTypeRef | undefined,
): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> | undefined {
  if (contract.asynchronous || contract.typeParameters.length !== 0) return undefined;
  return Object.freeze({
    kind: "callable",
    parameters: Object.freeze(parameters.map((parameter) => Object.freeze({
      name: parameter.name,
      convention: mojoParameterConvention(parameter.disposition),
      passing: parameter.disposition.kind === "owned" ? "consume" as const : "plain" as const,
      type: parameter.callType,
      omissionKind: parameter.omissionKind,
    }))),
    result: resultType,
    raises: contract.raises,
    ...(errorType === undefined ? {} : { errorType }),
  });
}

export function methodStorageType(
  callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
): Extract<MojoTargetTypeRef, { readonly kind: "optional" }> {
  return Object.freeze({ kind: "optional", value: callableType });
}

export function collectDispatchRepresentationTypes(
  views: readonly MojoProjectDispatchView[],
  concreteDispatch: ReadonlyMap<MojoProjectTypeDefinition, MojoProjectConcreteDispatch>,
  objectLiteralDispatches: readonly MojoProjectObjectLiteralDispatch[],
): readonly MojoTargetTypeRef[] {
  const types: MojoTargetTypeRef[] = [projectObjectType];
  const addParameter = (parameter: MojoAnalyzedParameter): void => {
    types.push(parameter.type, parameter.bodyType, parameter.callType);
  };
  const addParameters = (parameters: readonly MojoAnalyzedParameter[]): void => {
    for (const parameter of parameters) addParameter(parameter);
  };
  const addView = (view: MojoProjectDispatchView): void => {
    types.push(view.type);
    for (const callable of view.callables) {
      types.push(callable.slotType, callable.resultType);
      if (callable.errorType !== undefined) types.push(callable.errorType);
      addParameters(callable.parameters);
      if (callable.property !== undefined) {
        types.push(callable.property.callableType);
        if (callable.property.read !== undefined) types.push(callable.property.read.slotType);
        if (callable.property.write !== undefined) types.push(callable.property.write.slotType);
      }
    }
    for (const field of view.fields) {
      if (field.read !== undefined) types.push(field.read.slotType, field.read.valueType);
      if (field.write !== undefined) types.push(field.write.slotType, field.write.valueType);
    }
    for (const index of view.indexes) {
      types.push(index.keyType, index.valueType, index.read.slotType, index.copy.slotType);
      if (index.write !== undefined) types.push(index.write.slotType);
    }
    for (const downcast of view.downcasts) types.push(downcast.targetType, downcast.slotType);
    for (const conversion of view.conversions) {
      types.push(conversion.targetType, conversion.slotType);
    }
  };
  const addParameterAdapters = (
    adapters: readonly import("../program/model.js").MojoCallableParameterAdapter[],
  ): void => {
    for (const adapter of adapters) {
      addParameter(adapter.target);
      if (adapter.kind === "value" || adapter.kind === "sequence-rest") {
        addParameter(adapter.source);
      } else if (adapter.kind === "fixed-rest") {
        addParameters(adapter.sources);
      }
    }
  };
  for (const view of views) addView(view);
  for (const concrete of concreteDispatch.values()) {
    types.push(concrete.concrete.targetType);
    for (const storage of concrete.methodStorages) {
      types.push(storage.callableType, storage.storageType);
    }
    for (const storage of concrete.indexStorages) types.push(storage.type);
    for (const view of concrete.views) {
      types.push(view.viewType);
      for (const adapter of view.callableAdapters) {
        types.push(adapter.resultType, adapter.implementationOwnerType);
        if (adapter.errorType !== undefined) types.push(adapter.errorType);
        addParameters(adapter.parameters);
        addParameterAdapters(adapter.parameterAdapters);
      }
      for (const adapter of view.fieldAdapters) {
        if (adapter.readType !== undefined) types.push(adapter.readType);
        if (adapter.writeType !== undefined) types.push(adapter.writeType);
        if (adapter.kind === "stored") types.push(adapter.storageType);
        if (adapter.kind === "accessor") {
          types.push(adapter.implementationOwnerType);
          if (adapter.writeImplementationParameter !== undefined) {
            addParameter(adapter.writeImplementationParameter);
          }
        }
      }
      for (const adapter of view.indexAdapters) types.push(adapter.storageType);
    }
  }
  for (const dispatch of objectLiteralDispatches) {
    types.push(dispatch.selection.constructionType, dispatch.selection.resultType);
    for (const capture of dispatch.captures) types.push(capture.capture.type, capture.storageType);
    for (const storage of dispatch.methodStorages) {
      types.push(storage.callableType, storage.storageType);
    }
    for (const view of dispatch.views) {
      types.push(view.viewType);
      for (const adapter of view.callableAdapters) {
        types.push(adapter.resultType);
        if (adapter.errorType !== undefined) types.push(adapter.errorType);
        addParameters(adapter.parameters);
        addParameterAdapters(adapter.parameterAdapters);
      }
      for (const adapter of view.fieldAdapters) {
        if (adapter.kind === "stored") types.push(adapter.storageType);
        if (adapter.readType !== undefined) types.push(adapter.readType);
        if (adapter.writeType !== undefined) types.push(adapter.writeType);
      }
      for (const adapter of view.indexAdapters) types.push(adapter.storageType);
    }
  }
  const unique = new Map<string, MojoTargetTypeRef>();
  for (const type of types) unique.set(mojoTargetTypeKey(type), type);
  return Object.freeze([...unique].sort(([left], [right]) =>
    left.localeCompare(right, "en")).map(([, type]) => type));
}

export function collectSelectedGenericArguments(
  specializations: MojoSourceCallableSpecializationPlan,
): WeakMap<Node, readonly (readonly MojoTargetGenericArgument[])[]> {
  const pending = new WeakMap<Node, MojoTargetGenericArgument[][]>();
  for (const request of specializations.projectMethodRequests) {
    if (request.targetArguments.length === 0) continue;
    const current = pending.get(request.declaration) ?? [];
    if (!current.some((arguments_) =>
      mojoTargetGenericArgumentsEqual(arguments_, request.targetArguments))) {
      current.push([...request.targetArguments]);
    }
    pending.set(request.declaration, current);
  }
  return pending;
}

export function relatedDefinitions(
  definition: MojoProjectTypeDefinition,
  relationships: MojoProjectTypeRelationships,
): readonly MojoProjectTypeDefinition[] {
  const source = relationships.openType(definition);
  return relationships.definitions.filter((candidate) =>
    relationships.relationship(source, candidate).kind === "related");
}

export function callableContracts(
  analyzed: MojoAnalyzedClass | MojoAnalyzedInterface,
): readonly MojoAnalyzedCallableSignature[] {
  return analyzed.kind === "class"
    ? analyzed.callableContracts.filter((contract) => contract.kind === "method")
    : analyzed.methods;
}

export function dispatchProperties(
  analyzed: MojoAnalyzedClass | MojoAnalyzedInterface,
): readonly (
    MojoAnalyzedClass["fields"][number] |
    MojoAnalyzedInterface["fields"][number] |
    MojoAnalyzedAccessorProperty
  )[] {
  return analyzed.kind === "class"
    ? [...analyzed.fields, ...analyzed.accessorProperties]
    : [...analyzed.fields, ...analyzed.accessorProperties];
}

export function createCallableVariant(
  receiverType: MojoTargetTypeRef,
  contract: MojoAnalyzedCallableSignature,
  genericArguments: readonly MojoTargetGenericArgument[],
  usedNames: Set<string>,
  specializationCount: number,
  relationships: MojoProjectTypeRelationships,
  propertyUsage: MethodPropertyUsage | undefined,
): MojoProjectDispatchCallableVariant | undefined {
  const substitutions = callableSubstitutions(contract, genericArguments);
  if (substitutions === undefined) return undefined;
  const parameters = contract.parameters.map((parameter) =>
    instantiateMemberParameter(contract, receiverType, parameter, relationships));
  const receiverResultType = relationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    contract.resultType,
  );
  const receiverErrorType = contract.errorType === undefined
    ? undefined
    : relationships.instantiateMemberType(
        contract.declaration,
        receiverType,
        contract.errorType,
      );
  if (parameters.some((parameter) => parameter === undefined) ||
    receiverResultType === undefined ||
    (contract.errorType !== undefined && receiverErrorType === undefined)) return undefined;
  const closedParameters = Object.freeze((parameters as MojoAnalyzedParameter[]).map((parameter) =>
    substituteParameter(parameter, substitutions)));
  const resultType = substituteMojoTargetType(receiverResultType, substitutions);
  const errorType = contract.errorType === undefined
    ? undefined
    : substituteMojoTargetType(receiverErrorType!, substitutions);
  const name = allocateName(
    usedNames,
    specializationCount <= 1 ? contract.name : `${contract.name}_specialization`,
  );
  const slotName = allocateName(usedNames, `_${name}_dispatch`);
  const contractCallableType = propertyUsage === undefined
    ? undefined
    : dispatchCallableType(contract, closedParameters, resultType, errorType);
  if (propertyUsage !== undefined && contractCallableType === undefined) return undefined;
  const callableType = contractCallableType === undefined || propertyUsage === undefined
    ? undefined
    : selectMethodPropertyCallableType(propertyUsage, contractCallableType);
  if (propertyUsage !== undefined && callableType === undefined) return undefined;
  const property = callableType === undefined || propertyUsage === undefined
    ? undefined
    : createMethodProperty(
        callableType,
        propertyUsage,
        name,
        usedNames,
      );
  const raises = propertyUsage?.writable === true && callableType !== undefined
    ? callableType.raises
    : contract.raises;
  const effectiveErrorType = raises
    ? propertyUsage?.writable === true && callableType !== undefined
      ? callableType.errorType
      : errorType
    : undefined;
  return Object.freeze({
    contract,
    genericArguments: Object.freeze([...genericArguments]),
    name,
    slotName,
    slotType: functionType([
      { type: projectObjectType, convention: "imm", passing: "plain" },
      ...closedParameters.map((parameter) => ({
        type: parameter.omissionKind === "rest" ? parameter.type : parameter.callType,
        convention: mojoParameterConvention(parameter.disposition),
        passing: parameter.disposition.kind === "owned" ? "consume" as const : "plain" as const,
        omissionKind: parameter.omissionKind,
      })),
    ], resultType, contract.asynchronous, raises, effectiveErrorType),
    parameters: closedParameters,
    resultType,
    raises,
    ...(effectiveErrorType === undefined ? {} : { errorType: effectiveErrorType }),
    ...(property === undefined ? {} : { property }),
  });
}

export function selectMethodPropertyCallableType(
  usage: MethodPropertyUsage,
  contractType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> | undefined {
  if (usage.callableTypes.length > 1) return undefined;
  const selected = usage.callableTypes[0];
  if (selected === undefined) return contractType;
  const { errorType: ignoredContractError, ...contractWithoutError } = contractType;
  const { errorType: ignoredSelectedError, ...selectedWithoutError } = selected;
  void ignoredContractError;
  void ignoredSelectedError;
  const contractShape = Object.freeze({ ...contractWithoutError, raises: false });
  const selectedShape = Object.freeze({ ...selectedWithoutError, raises: false });
  return mojoTargetTypeEquals(contractShape, selectedShape) ? selected : undefined;
}

export function instantiateMemberParameter(
  contract: MojoAnalyzedCallableSignature,
  receiverType: MojoTargetTypeRef,
  parameter: MojoAnalyzedParameter,
  relationships: MojoProjectTypeRelationships,
): MojoAnalyzedParameter | undefined {
  const type = relationships.instantiateMemberType(contract.declaration, receiverType, parameter.type);
  const bodyType = relationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    parameter.bodyType,
  );
  const callType = relationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    parameter.callType,
  );
  return type === undefined || bodyType === undefined || callType === undefined
    ? undefined
    : Object.freeze({ ...parameter, type, bodyType, callType });
}

export function instantiateParameterForType(
  definition: MojoProjectTypeDefinition,
  instance: MojoTargetTypeRef,
  parameter: MojoAnalyzedParameter,
  relationships: MojoProjectTypeRelationships,
): MojoAnalyzedParameter | undefined {
  const type = relationships.instantiateType(definition, instance, parameter.type);
  const bodyType = relationships.instantiateType(definition, instance, parameter.bodyType);
  const callType = relationships.instantiateType(definition, instance, parameter.callType);
  return type === undefined || bodyType === undefined || callType === undefined
    ? undefined
    : Object.freeze({ ...parameter, type, bodyType, callType });
}
