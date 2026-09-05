import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedParameter,
  MojoProjectConcreteDispatch,
  MojoProjectConcreteViewDispatch,
  MojoProjectDowncastAdapter,
  MojoProjectDispatchCallableAdapter,
  MojoProjectDispatchField,
  MojoProjectDispatchFieldAdapter,
  MojoProjectDispatchIndexAdapter,
  MojoProjectDispatchView,
  MojoProjectMethodStorage,
} from "../program/model.js";
import type {
  MojoProjectTypeDefinition,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { selectMojoCallableParameterAdapters } from "../callables/parameter-adapters.js";
import type { MojoSourceCallableSpecializationPlan } from "../callables/specializations.js";
import {
  dispatchCallableType,
  instantiateMemberParameter,
  instantiateParameterForType,
  methodStorageType,
  selectMethodPropertyCallableType,
} from "./dispatch-callables.js";
import type { MethodPropertyUsage } from "./dispatch-callables.js";
import { createFieldAdapter, createIndexAdapter } from "./dispatch-fields.js";
import {
  allocateName,
  callableSubstitutions,
  substituteParameter,
} from "./dispatch-support.js";

export function createConcreteDispatchPlans(input: {
  readonly classes: readonly MojoAnalyzedClass[];
  readonly relationships: MojoProjectTypeRelationships;
  readonly implementations: WeakMap<Node, MojoAnalyzedFunction>;
  readonly sourceCallableSpecializations: MojoSourceCallableSpecializationPlan;
  readonly views: readonly MojoProjectDispatchView[];
  readonly implementationNames: WeakMap<Node, string>;
  readonly usedNamesByClass: ReadonlyMap<MojoProjectTypeDefinition, Set<string>>;
  readonly implementationMethodPropertyUsages: ReadonlyMap<Node, MethodPropertyUsage>;
  readonly propertiesByDeclaration: WeakMap<Node, MojoProjectDispatchField["property"]>;
  readonly issues: { readonly node: Node; readonly code: string; readonly message: string }[];
}): ReadonlyMap<MojoProjectTypeDefinition, MojoProjectConcreteDispatch> {
  const {
    views,
    implementationNames,
    implementationMethodPropertyUsages,
    propertiesByDeclaration,
    issues,
  } = input;
  const generatedNames = { usedByClass: input.usedNamesByClass };
  const concreteDispatch = new Map<MojoProjectTypeDefinition, MojoProjectConcreteDispatch>();
  for (const concrete of input.classes) {
    if (!concrete.polymorphic) continue;
    const concreteViews: MojoProjectConcreteViewDispatch[] = [];
    const adapterNames = generatedNames.usedByClass.get(concrete.definition) ?? new Set<string>();
    const methodStoragesByImplementation = new Map<Node, MojoProjectMethodStorage>();
    const indexStoragesByDeclaration = new Map<Node, {
      readonly name: string;
      readonly type: Extract<MojoTargetTypeRef, { readonly kind: "dictionary" }>;
    }>();
    for (const view of views) {
      const relationship = input.relationships.relationship(concrete.targetType, view.definition);
      if (relationship.kind !== "related") continue;
      const callableAdapters: MojoProjectDispatchCallableAdapter[] = [];
      for (const variant of view.callables) {
        const concreteGenericArguments = input.relationships.instantiateGenericArguments(
          view.definition,
          relationship.targetType,
          variant.genericArguments,
        );
        const concreteParameters = variant.parameters.map((parameter) =>
          instantiateParameterForType(
            view.definition,
            relationship.targetType,
            parameter,
            input.relationships,
          ));
        const concreteResult = input.relationships.instantiateType(
          view.definition,
          relationship.targetType,
          variant.resultType,
        );
        const concreteError = variant.errorType === undefined
          ? undefined
          : input.relationships.instantiateType(
              view.definition,
              relationship.targetType,
              variant.errorType,
            );
        const concretePropertyCallableType = variant.property === undefined
          ? undefined
          : input.relationships.instantiateType(
              view.definition,
              relationship.targetType,
              variant.property.callableType,
            );
        if (concreteGenericArguments === undefined ||
          concreteParameters.some((parameter) => parameter === undefined) ||
          concreteResult === undefined ||
          (variant.errorType !== undefined && concreteError === undefined) ||
          (variant.property !== undefined &&
            (concretePropertyCallableType === undefined ||
              concretePropertyCallableType.kind !== "callable"))) {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_CONCRETE_DISPATCH_SIGNATURE_UNCLOSED",
            message: `Concrete class '${concrete.name}' cannot instantiate the selected project dispatch signature.`,
          }));
          continue;
        }
        const closedConcreteParameters = concreteParameters as readonly MojoAnalyzedParameter[];
        const selected = input.relationships.memberImplementation(
          concrete.definition,
          variant.contract.declaration,
        );
        if (selected.kind !== "resolved") {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_DISPATCH_IMPLEMENTATION_UNRESOLVED",
            message: selected.kind === "unresolved"
              ? selected.reason
              : `Concrete class '${concrete.name}' does not implement the selected project method contract.`,
          }));
          continue;
        }
        const implementation = input.implementations.get(selected.implementation.declaration);
        const implementationOwner = input.relationships.definitionContainingDeclaration(
          selected.implementation.declaration,
        );
        const implementationRelation = implementationOwner === undefined
          ? undefined
          : input.relationships.relationship(concrete.targetType, implementationOwner);
        const implementationRequiresSpecialization = input.sourceCallableSpecializations
          .requiresSpecialization(selected.implementation.declaration);
        const implementationSpecialization = implementationRequiresSpecialization
          ? input.sourceCallableSpecializations.variantForCall(
              selected.implementation.declaration,
              concreteGenericArguments,
            )
          : undefined;
        const implementationName = implementationRequiresSpecialization
          ? implementationSpecialization?.targetName
          : implementationNames.get(selected.implementation.declaration);
        if (implementation === undefined || implementationName === undefined ||
          implementationRelation?.kind !== "related") {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_DISPATCH_IMPLEMENTATION_NOT_ANALYZED",
            message: `Concrete class '${concrete.name}' has no exact analyzed implementation for the selected project method contract.`,
          }));
          continue;
        }
        const implementationSubstitutions = callableSubstitutions(
          implementation,
          concreteGenericArguments,
        );
        const implementationParameters = implementationSubstitutions === undefined
          ? undefined
          : implementation.parameters.map((parameter) => {
              const instantiated = instantiateMemberParameter(
                implementation,
                implementationRelation.targetType,
                parameter,
                input.relationships,
              );
              return instantiated === undefined
                ? undefined
                : substituteParameter(instantiated, implementationSubstitutions);
            });
        const implementationResult = implementationSubstitutions === undefined
          ? undefined
          : input.relationships.instantiateMemberType(
              implementation.declaration,
              implementationRelation.targetType,
              implementation.resultType,
            );
        const closedImplementationResult = implementationResult === undefined ||
            implementationSubstitutions === undefined
          ? undefined
          : substituteMojoTargetType(implementationResult, implementationSubstitutions);
        const implementationError = implementation.errorType === undefined
          ? undefined
          : input.relationships.instantiateMemberType(
              implementation.declaration,
              implementationRelation.targetType,
              implementation.errorType,
            );
        const closedImplementationError = implementationError === undefined ||
            implementationSubstitutions === undefined
          ? undefined
          : substituteMojoTargetType(implementationError, implementationSubstitutions);
        const implementationUsage = implementationMethodPropertyUsages.get(
          selected.implementation.declaration,
        );
        const implementationContractType = implementationUsage?.writable === true
          ? dispatchCallableType(
              variant.contract,
              closedConcreteParameters,
              concreteResult,
              concreteError,
            )
          : undefined;
        const writableCallableType = implementationUsage?.writable === true &&
            implementationContractType !== undefined
          ? selectMethodPropertyCallableType(
              implementationUsage,
              implementationContractType,
            )
          : undefined;
        const adapterRaises = variant.raises || writableCallableType?.raises === true;
        const adapterErrorType = writableCallableType?.raises === true
          ? writableCallableType.errorType
          : concreteError;
        if (implementationParameters === undefined ||
          implementationParameters.some((parameter) => parameter === undefined) ||
          closedImplementationResult === undefined ||
          implementation.asynchronous !== variant.contract.asynchronous ||
          implementation.raises && !adapterRaises ||
          implementation.raises && (
            (closedImplementationError === undefined) !== (adapterErrorType === undefined) ||
            closedImplementationError !== undefined && adapterErrorType !== undefined &&
              !mojoTargetTypeEquals(closedImplementationError, adapterErrorType)
          )) {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_DISPATCH_IMPLEMENTATION_ABI_UNCLOSED",
            message: `Concrete class '${concrete.name}' has no exact closed ABI for the selected project method contract.`,
          }));
          continue;
        }
        const closedImplementationParameters = implementationParameters as readonly MojoAnalyzedParameter[];
        const parameterAdapters = selectMojoCallableParameterAdapters(
          closedConcreteParameters,
          closedImplementationParameters,
          input.relationships,
        );
        const resultConversion = classifyMojoValueConversion(
          closedImplementationResult,
          concreteResult,
          undefined,
          input.relationships,
        );
        if (parameterAdapters === undefined || resultConversion.kind === "unsupported") {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_DISPATCH_IMPLEMENTATION_CONVERSION_UNPROVEN",
            message: `Concrete class '${concrete.name}' cannot exactly adapt the selected project method implementation ABI.`,
          }));
          continue;
        }
        let methodStorage: MojoProjectMethodStorage | undefined;
        if (implementationUsage?.writable === true) {
          const callableType = writableCallableType;
          if (callableType === undefined) {
            issues.push(Object.freeze({
              node: variant.contract.declaration,
              code: "MOJO_PROJECT_METHOD_PROPERTY_ABI_UNSUPPORTED",
              message: "A mutable project method requires one synchronous closed callable ABI.",
            }));
            continue;
          }
          const existingStorage = methodStoragesByImplementation.get(
            selected.implementation.declaration,
          );
          if (existingStorage !== undefined &&
            !mojoTargetTypeEquals(existingStorage.callableType, callableType)) {
            issues.push(Object.freeze({
              node: variant.contract.declaration,
              code: "MOJO_PROJECT_METHOD_PROPERTY_ABI_CONFLICT",
              message: "One mutable project method implementation is exposed through incompatible callable ABIs.",
            }));
            continue;
          }
          methodStorage = existingStorage ?? Object.freeze({
            declarations: Object.freeze([selected.implementation.declaration]),
            name: allocateName(adapterNames, `_method_${implementation.name}`),
            callableType,
            storageType: methodStorageType(callableType),
          });
          methodStoragesByImplementation.set(
            selected.implementation.declaration,
            methodStorage,
          );
        }
        const adapterName = allocateName(
          adapterNames,
          `_dispatch_${view.definition.targetName}_${variant.name}`,
        );
        const methodCallAdapterName = methodStorage === undefined
          ? undefined
          : allocateName(adapterNames, `${adapterName}_current`);
        const methodBindAdapterName = variant.property?.read === undefined
          ? undefined
          : allocateName(adapterNames, `${adapterName}_bound`);
        const methodReadAdapterName = variant.property?.read === undefined
          ? undefined
          : allocateName(adapterNames, `${adapterName}_read`);
        const methodWriteAdapterName = variant.property?.write === undefined
          ? undefined
          : allocateName(adapterNames, `${adapterName}_write`);
        callableAdapters.push(Object.freeze({
          variant,
          genericArguments: concreteGenericArguments,
          parameters: Object.freeze(closedConcreteParameters),
          resultType: concreteResult,
          raises: adapterRaises,
          ...(adapterErrorType === undefined ? {} : { errorType: adapterErrorType }),
          adapterName,
          implementationName,
          implementation,
          implementationOwnerType: implementationRelation.targetType,
          parameterAdapters,
          resultConversion: resultConversion.conversion,
          ...(methodStorage === undefined ? {} : { methodStorage }),
          ...(methodCallAdapterName === undefined ? {} : { methodCallAdapterName }),
          ...(methodBindAdapterName === undefined ? {} : { methodBindAdapterName }),
          ...(methodReadAdapterName === undefined ? {} : { methodReadAdapterName }),
          ...(methodWriteAdapterName === undefined ? {} : { methodWriteAdapterName }),
        }));
      }
      const fieldAdapters = view.fields.map((field): MojoProjectDispatchFieldAdapter | undefined =>
        createFieldAdapter(
          field,
          concrete,
          view.definition,
          relationship.targetType,
          input.relationships,
          input.implementations,
          propertiesByDeclaration,
          adapterNames,
        ));
      if (fieldAdapters.some((adapter) => adapter === undefined)) {
        issues.push(Object.freeze({
          node: view.definition.declaration,
          code: "MOJO_PROJECT_FIELD_DISPATCH_IMPLEMENTATION_UNRESOLVED",
          message: `Concrete class '${concrete.name}' does not close every field contract for '${view.definition.sourceName}'.`,
        }));
      }
      const indexAdapters = view.indexes.map((index): MojoProjectDispatchIndexAdapter | undefined => {
        const keyType = input.relationships.instantiateType(
          view.definition,
          relationship.targetType,
          index.keyType,
        );
        const valueType = input.relationships.instantiateType(
          view.definition,
          relationship.targetType,
          index.valueType,
        );
        if (keyType === undefined || valueType === undefined) return undefined;
        const storageType = Object.freeze({
          kind: "dictionary" as const,
          key: keyType,
          value: valueType,
        });
        let storage = indexStoragesByDeclaration.get(index.indexSignature.declaration);
        if (storage === undefined) {
          storage = Object.freeze({
            name: allocateName(adapterNames, index.indexSignature.storageName),
            type: storageType,
          });
          indexStoragesByDeclaration.set(index.indexSignature.declaration, storage);
        }
        if (!mojoTargetTypeEquals(storage.type, storageType)) return undefined;
        return createIndexAdapter(index, storage.name, storageType, adapterNames);
      });
      if (indexAdapters.some((adapter) => adapter === undefined)) {
        issues.push(Object.freeze({
          node: view.definition.declaration,
          code: "MOJO_PROJECT_INDEX_DISPATCH_IMPLEMENTATION_UNRESOLVED",
          message: `Concrete class '${concrete.name}' does not close every index contract for '${view.definition.sourceName}'.`,
        }));
      }
      const downcastAdapters: MojoProjectDowncastAdapter[] = view.downcasts.map((route) => {
        const targetRelationship = input.relationships.relationship(
          concrete.targetType,
          route.target,
        );
        return Object.freeze({
          route,
          adapterName: allocateName(
            adapterNames,
            `_dispatch_${view.definition.targetName}_${route.name}`,
          ),
          available: targetRelationship.kind === "related" &&
            mojoTargetTypeEquals(targetRelationship.targetType, route.targetType),
        });
      });
      concreteViews.push(Object.freeze({
        view,
        viewType: relationship.targetType,
        conversionAdapterName: allocateName(adapterNames, `_view_as_${view.definition.targetName}`),
        callableAdapters: Object.freeze(callableAdapters),
        fieldAdapters: Object.freeze(fieldAdapters.filter(
          (adapter): adapter is MojoProjectDispatchFieldAdapter => adapter !== undefined,
        )),
        indexAdapters: Object.freeze(indexAdapters.filter(
          (adapter): adapter is MojoProjectDispatchIndexAdapter => adapter !== undefined,
        )),
        downcastAdapters: Object.freeze(downcastAdapters),
      }));
    }
    concreteDispatch.set(concrete.definition, Object.freeze({
      concrete,
      views: Object.freeze(concreteViews),
      methodStorages: Object.freeze([...methodStoragesByImplementation.values()]),
      indexStorages: Object.freeze([...indexStoragesByDeclaration.values()]),
    }));
  }
  return concreteDispatch;
}

