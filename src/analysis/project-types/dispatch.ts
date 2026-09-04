import type { Node } from "@tsonic/tsts";
import { mojoParameterConvention } from "../representations/index.js";
import type {
  MojoAnalyzedAccessorProperty,
  MojoAnalyzedCallableSignature,
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedParameter,
  MojoProjectConcreteDispatch,
  MojoProjectConcreteViewDispatch,
  MojoProjectDowncastAdapter,
  MojoProjectDowncastRoute,
  MojoProjectDispatchCallableAdapter,
  MojoProjectDispatchCallableVariant,
  MojoProjectDispatchField,
  MojoProjectDispatchFieldAdapter,
  MojoProjectDispatchIndex,
  MojoProjectDispatchIndexAdapter,
  MojoProjectDispatchMethodProperty,
  MojoProjectDispatchPlan,
  MojoProjectDispatchView,
  MojoProjectMethodStorage,
  MojoProjectObjectLiteralDispatch,
  MojoObjectLiteralSelection,
  MojoObjectLiteralContribution,
  MojoCallableExpressionSelection,
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
import type { MojoTargetTypeSubstitutions } from "../../target-model/types/substitution.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import { selectMojoCallableParameterAdapters } from "../callables/parameter-adapters.js";
import type { MojoSourceCallableSpecializationPlan } from "../callables/specializations.js";

const maximumDispatchEntries = 1_048_576;
const projectObjectType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "tsonic.mojo.runtime.ProjectObject",
  modulePath: Object.freeze(["tsonic_runtime"]),
  name: "ProjectObject",
});
const optionalProjectObjectType: MojoTargetTypeRef = Object.freeze({
  kind: "optional",
  value: projectObjectType,
});

export function createMojoProjectDispatchPlan(input: {
  readonly classes: readonly MojoAnalyzedClass[];
  readonly interfaces: readonly MojoAnalyzedInterface[];
  readonly relationships: MojoProjectTypeRelationships;
  readonly modules: import("../source-modules/model.js").MojoSourceModuleCatalog;
  readonly propertyNodes: ReadonlySet<Node>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly implementations: WeakMap<Node, MojoAnalyzedFunction>;
  readonly objectLiteralNodes: ReadonlySet<Node>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly sourceCallableSpecializations: MojoSourceCallableSpecializationPlan;
  readonly libraryOutput: boolean;
}): MojoProjectDispatchPlan {
  const issues: { readonly node: Node; readonly code: string; readonly message: string }[] = [];
  const analyzedByDefinition = new Map<
    MojoProjectTypeDefinition,
    MojoAnalyzedClass | MojoAnalyzedInterface
  >([
    ...input.classes.map((class_) => [class_.definition, class_] as const),
    ...input.interfaces.map((interface_) => [interface_.definition, interface_] as const),
  ]);
  const selectedGenericArguments = collectSelectedGenericArguments(
    input.sourceCallableSpecializations,
  );
  const methodPropertyUsages = collectMethodPropertyUsages(
    input.propertyNodes,
    input.propertySelections,
    input.objectLiteralNodes,
    input.objectLiteralSelections,
    issues,
  );
  const implementationMethodPropertyUsages = collectImplementationMethodPropertyUsages(
    methodPropertyUsages,
    input.classes,
    input.relationships,
  );
  const propertiesByDeclaration = createPropertyIndex(input.classes, input.interfaces);
  const views: MojoProjectDispatchView[] = [];
  let entryCount = 0;

  for (const analyzed of [...input.classes, ...input.interfaces]) {
    if (!analyzed.polymorphic) continue;
    const usedNames = new Set<string>(input.sourceCallableSpecializations.allocatedNames);
    const callables: MojoProjectDispatchCallableVariant[] = [];
    const fields: MojoProjectDispatchField[] = [];
    const indexes: MojoProjectDispatchIndex[] = [];
    const related = relatedDefinitions(analyzed.definition, input.relationships)
      .map((definition) => analyzedByDefinition.get(definition))
      .filter((value): value is MojoAnalyzedClass | MojoAnalyzedInterface => value !== undefined);
    const contractOwners = related.filter((owner) => owner.kind === analyzed.kind);

    for (const owner of contractOwners) {
      for (const contract of callableContracts(owner)) {
        if (contract.static === true || contract.kind === "constructor") continue;
        const propertyUsage = implementationMethodPropertyUsages.get(contract.declaration);
        if (propertyUsage !== undefined && contract.asynchronous) {
          issues.push(Object.freeze({
            node: contract.declaration,
            code: "MOJO_ASYNC_PROJECT_METHOD_PROPERTY_NATIVE_LIMIT",
            message: "The pinned Mojo callable ABI cannot retain an asynchronous bound project method value.",
          }));
          continue;
        }
        const selected = contract.typeParameters.length === 0
          ? [Object.freeze([] as MojoTargetGenericArgument[])]
          : selectedGenericArguments.get(contract.declaration) ?? [];
        if (contract.typeParameters.length !== 0 && input.libraryOutput) {
          issues.push(Object.freeze({
            node: contract.declaration,
            code: "MOJO_OPEN_LIBRARY_VIRTUAL_GENERIC_UNSUPPORTED",
            message: "A public polymorphic generic method has an open external specialization set that Mojo cannot represent as a finite native dispatch table.",
          }));
          continue;
        }
        for (const genericArguments of selected) {
          if (!genericArgumentsCloseOverView(genericArguments, analyzed.definition)) {
            issues.push(Object.freeze({
              node: contract.declaration,
              code: "MOJO_OPEN_GENERIC_VIRTUAL_CALL_UNSUPPORTED",
              message: "A polymorphic generic call retains a generic argument outside its receiver contract and therefore has no finite Mojo dispatch slot.",
            }));
            continue;
          }
          const variant = createCallableVariant(
            analyzed.targetType,
            contract,
            genericArguments,
            usedNames,
            selected.length,
            input.relationships,
            propertyUsage,
          );
          if (variant === undefined) {
            issues.push(Object.freeze({
              node: contract.declaration,
              code: "MOJO_PROJECT_DISPATCH_SIGNATURE_UNCLOSED",
              message: "A project dispatch method does not close its exact generic signature.",
            }));
            continue;
          }
          callables.push(variant);
          entryCount += 1;
        }
      }
      for (const property of dispatchProperties(owner)) {
        if (fields.some((field) => sameProperty(field.property, property))) continue;
        const field = createDispatchField(
          analyzed.targetType,
          property,
          usedNames,
          input.relationships,
        );
        if (field === undefined) {
          issues.push(Object.freeze({
            node: propertyDeclarations(property)[0]!,
            code: "MOJO_PROJECT_DISPATCH_FIELD_UNCLOSED",
            message: "A project dispatch property does not close through its exact receiver relationship.",
          }));
          continue;
        }
        fields.push(field);
        entryCount += 1;
      }
      if (owner.kind === "interface") {
        for (const indexSignature of owner.indexSignatures) {
          if (indexes.some((index) =>
            index.indexSignature.declaration === indexSignature.declaration)) continue;
          const index = createDispatchIndex(
            analyzed.targetType,
            indexSignature,
            usedNames,
            input.relationships,
          );
          if (index === undefined) {
            issues.push(Object.freeze({
              node: indexSignature.declaration,
              code: "MOJO_PROJECT_DISPATCH_INDEX_UNCLOSED",
              message: "A project dispatch index signature does not close through its exact receiver relationship.",
            }));
            continue;
          }
          indexes.push(index);
          entryCount += index.write === undefined ? 2 : 3;
        }
      }
    }

    const sourceComponent = input.modules.forSourceFile(analyzed.sourceFile)?.componentId;
    const downcasts: MojoProjectDowncastRoute[] = sourceComponent === undefined
      ? []
      : input.classes
          .filter((target) => target.definition !== analyzed.definition &&
            target.definition.typeParameters.length === 0 &&
            input.modules.forSourceFile(target.sourceFile)?.componentId === sourceComponent)
          .filter((target) => input.relationships.relationship(
            input.relationships.openType(target.definition),
            analyzed.definition,
          ).kind === "related")
          .sort((left, right) => left.definition.id.localeCompare(right.definition.id, "en"))
          .map((target) => {
            const targetType = input.relationships.openType(target.definition);
            return Object.freeze({
              source: analyzed.definition,
              target: target.definition,
              targetType,
              name: allocateName(usedNames, `try_as_${target.name}`),
              slotName: allocateName(usedNames, `_downcast_${target.name}_dispatch`),
              slotType: functionType(
                [{ type: projectObjectType, convention: "imm", passing: "plain" }],
                optionalProjectObjectType,
                false,
                false,
              ),
            });
          });
    entryCount += downcasts.length;
    const conversions = related
      .filter((target) => target.definition !== analyzed.definition)
      .map((target) => {
        const relationship = input.relationships.relationship(analyzed.targetType, target.definition);
        if (relationship.kind !== "related") return undefined;
        const base = `_as_${target.name}`;
        const name = allocateName(usedNames, base);
        const slotName = allocateName(usedNames, `_${target.name}_conversion`);
        return Object.freeze({
          target: target.definition,
          targetType: relationship.targetType,
          name,
          slotName,
          slotType: functionType(
            [{ type: projectObjectType, convention: "imm", passing: "plain" }],
            relationship.targetType,
            false,
            false,
          ),
        });
      })
      .filter((conversion): conversion is NonNullable<typeof conversion> => conversion !== undefined);
    entryCount += conversions.length;
    views.push(Object.freeze({
      definition: analyzed.definition,
      type: analyzed.targetType,
      callables: Object.freeze(callables),
      fields: Object.freeze(fields),
      indexes: Object.freeze(indexes),
      downcasts: Object.freeze(downcasts),
      conversions: Object.freeze(conversions),
    }));
  }

  if (!Number.isSafeInteger(entryCount) || entryCount > maximumDispatchEntries) {
    const node = input.classes[0]?.declaration ?? input.interfaces[0]?.declaration;
    if (node !== undefined) {
      issues.push(Object.freeze({
        node,
        code: "MOJO_PROJECT_DISPATCH_BUDGET_EXCEEDED",
        message: `Project dispatch exceeds its finite ${maximumDispatchEntries}-entry analysis budget.`,
      }));
    }
  }

  const viewByDefinition = new Map(views.map((view) => [view.definition, view] as const));
  const generatedNames = createImplementationNames(
    input.classes,
    views,
    input.relationships,
    input.sourceCallableSpecializations,
  );
  const implementationNames = generatedNames.implementations;
  const viewForType = (type: MojoTargetTypeRef): MojoProjectDispatchView | undefined => {
    const definition = input.relationships.definitionForType(type);
    return definition === undefined ? undefined : viewByDefinition.get(definition);
  };
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

  const objectLiteralDispatch = createObjectLiteralDispatchPlans({
    nodes: input.objectLiteralNodes,
    selections: input.objectLiteralSelections,
    callables: input.callableExpressionSelections,
    relationships: input.relationships,
    views,
    issues,
    methodPropertyUsages,
  });

  const plan: MojoProjectDispatchPlan = {
    issues: Object.freeze(issues),
    representationTypes: collectDispatchRepresentationTypes(
      views,
      concreteDispatch,
      objectLiteralDispatch.plans,
    ),
    viewForType,
    callableFor(receiverType, declaration, genericArguments) {
      const view = viewForType(receiverType);
      const matches = view?.callables.filter((variant) =>
        variant.contract.declaration === declaration &&
        mojoTargetGenericArgumentsEqual(variant.genericArguments, genericArguments)) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    },
    fieldFor(receiverType, declaration) {
      const view = viewForType(receiverType);
      const matches = view?.fields.filter((field) => propertyDeclarations(field.property).includes(declaration)) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    },
    indexFor(receiverType, declaration) {
      const view = viewForType(receiverType);
      const matches = view?.indexes.filter((index) =>
        index.indexSignature.declaration === declaration) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    },
    downcastFor(sourceType, targetType) {
      const view = viewForType(sourceType);
      const target = input.relationships.definitionForType(targetType);
      const matches = target === undefined
        ? []
        : view?.downcasts.filter((route) => route.target === target &&
          mojoTargetTypeEquals(route.targetType, targetType)) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    },
    conversionFor(sourceType, targetType) {
      const view = viewForType(sourceType);
      const targetDefinition = input.relationships.definitionForType(targetType);
      const relationship = targetDefinition === undefined
        ? undefined
        : input.relationships.relationship(sourceType, targetDefinition);
      if (relationship?.kind !== "related" ||
        !mojoTargetTypeEquals(relationship.targetType, targetType)) return undefined;
      const matches = view?.conversions.filter((conversion) =>
        conversion.target === targetDefinition) ?? [];
      return matches.length === 1 ? matches[0] : undefined;
    },
    concreteFor(definition) {
      return concreteDispatch.get(definition);
    },
    objectLiteralFor(expression) {
      return objectLiteralDispatch.byExpression.get(expression);
    },
    statePath(definition, declaration) {
      const concrete = concreteDispatch.get(definition);
      const matches = concrete?.views.flatMap((view) => view.fieldAdapters.flatMap((adapter) =>
        adapter.kind === "stored" &&
          propertyDeclarations(adapter.field.property).includes(declaration)
          ? [adapter.statePath]
          : [])) ?? [];
      const unique = matches.filter((path, index) => matches.findIndex((candidate) =>
        samePath(candidate, path)) === index);
      return unique.length === 1 ? unique[0] : undefined;
    },
    implementationName(declaration, genericArguments = Object.freeze([])) {
      return input.sourceCallableSpecializations.requiresSpecialization(declaration)
        ? input.sourceCallableSpecializations.variantForCall(declaration, genericArguments)?.targetName
        : implementationNames.get(declaration);
    },
  };
  return Object.freeze(plan);
}

function createObjectLiteralDispatchPlans(input: {
  readonly nodes: ReadonlySet<Node>;
  readonly selections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly callables: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly relationships: MojoProjectTypeRelationships;
  readonly views: readonly MojoProjectDispatchView[];
  readonly issues: { readonly node: Node; readonly code: string; readonly message: string }[];
  readonly methodPropertyUsages: ReadonlyMap<Node, MethodPropertyUsage>;
}): {
  readonly byExpression: WeakMap<Node, MojoProjectObjectLiteralDispatch>;
  readonly plans: readonly MojoProjectObjectLiteralDispatch[];
} {
  const byExpression = new WeakMap<Node, MojoProjectObjectLiteralDispatch>();
  const plans: MojoProjectObjectLiteralDispatch[] = [];
  for (const expression of input.nodes) {
    const selection = input.selections.get(expression);
    if (selection?.kind !== "interface") continue;
    const methods = selection.contributions.filter((contribution) =>
      contribution.kind === "method");
    const getters = selection.contributions.filter((contribution) =>
      contribution.kind === "getter");
    const setters = selection.contributions.filter((contribution) =>
      contribution.kind === "setter");
    const implementations = [...methods, ...getters, ...setters].map((contribution) =>
      input.callables.get(contribution.element));
    if (implementations.some((implementation) => implementation === undefined)) {
      input.issues.push(Object.freeze({
        node: expression,
        code: "MOJO_OBJECT_DISPATCH_IMPLEMENTATION_NOT_FINALIZED",
        message: "A polymorphic object literal has an authored callable without one finalized implementation.",
      }));
      continue;
    }
    const usedNames = new Set<string>([
      ...selection.fields.map(({ field }) => field.name),
      ...selection.indexSignatures.map(({ indexSignature }) => indexSignature.storageName),
      "_view",
    ]);
    const capturesByDeclaration = new Map<Node, {
      readonly capture: import("../program/model.js").MojoCallableCapture;
      readonly stateName: string;
      readonly storageType: MojoTargetTypeRef;
    }>();
    let valid = true;
    for (const implementation of implementations as readonly MojoCallableExpressionSelection[]) {
      for (const capture of implementation.captures) {
        const existing = capturesByDeclaration.get(capture.declaration);
        if (existing !== undefined) {
          if (existing.capture.storage !== capture.storage ||
            !mojoTargetTypeEquals(existing.capture.type, capture.type)) {
            input.issues.push(Object.freeze({
              node: implementation.expression,
              code: "MOJO_OBJECT_CAPTURE_CONFLICT",
              message: "Object-literal members capture one source binding with incompatible sealed storage contracts.",
            }));
            valid = false;
          }
          continue;
        }
        const storageType = capture.storage === "location"
          ? mojoLocationType(capture.type)
          : capture.type;
        capturesByDeclaration.set(capture.declaration, Object.freeze({
          capture,
          stateName: allocateName(usedNames, capture.name),
          storageType,
        }));
      }
    }
    if (!valid) continue;

    type FinalMethodContribution =
      | {
          readonly kind: "authored";
          readonly contribution: Extract<MojoObjectLiteralContribution, {
            readonly kind: "method" | "getter" | "setter";
          }>;
          readonly implementation: MojoCallableExpressionSelection;
        }
      | {
          readonly kind: "spread";
          readonly contribution: Extract<MojoObjectLiteralContribution, { readonly kind: "spread" }>;
          readonly sourceDeclaration: Node;
        };
    const finalMethods = new Map<Node, FinalMethodContribution>();
    for (const contribution of selection.contributions) {
      if (contribution.kind === "method" || contribution.kind === "getter" ||
        contribution.kind === "setter") {
        const implementation = input.callables.get(contribution.element);
        if (implementation === undefined) continue;
        for (const declaration of contribution.contractDeclarations) {
          finalMethods.set(declaration, Object.freeze({
            kind: "authored",
            contribution,
            implementation,
          }));
        }
      } else if (contribution.kind === "spread") {
        for (const { method } of contribution.methods) {
          finalMethods.set(method.declaration, Object.freeze({
            kind: "spread",
            contribution,
            sourceDeclaration: method.declaration,
          }));
        }
      }
    }

    const objectViews: import("../program/model.js").MojoProjectObjectLiteralViewDispatch[] = [];
    const storedFields = new Map<Node, { readonly name: string; readonly type: MojoTargetTypeRef }>();
    const methodStorageBuilders: {
      readonly identity: Node;
      readonly sourceDeclaration?: Node;
      readonly declarations: Node[];
      readonly storage: import("../program/model.js").MojoProjectObjectLiteralMethodStorage;
    }[] = [];
    for (const view of input.views) {
      const relationship = input.relationships.relationship(
        selection.constructionType,
        view.definition,
      );
      if (relationship.kind !== "related") continue;
      const callableAdapters: import("../program/model.js").MojoProjectObjectLiteralCallableAdapter[] = [];
      for (const variant of view.callables) {
        const selectedMethod = finalMethods.get(variant.contract.declaration);
        const implementation = selectedMethod?.kind === "authored"
          ? selectedMethod.implementation
          : undefined;
        const genericArguments = input.relationships.instantiateGenericArguments(
          view.definition,
          relationship.targetType,
          variant.genericArguments,
        );
        const parameters = variant.parameters.map((parameter) =>
          instantiateParameterForType(
            view.definition,
            relationship.targetType,
            parameter,
            input.relationships,
          ));
        const resultType = input.relationships.instantiateType(
          view.definition,
          relationship.targetType,
          variant.resultType,
        );
        const errorType = variant.errorType === undefined
          ? undefined
          : input.relationships.instantiateType(
              view.definition,
              relationship.targetType,
              variant.errorType,
            );
        const substitutions = selectedMethod?.kind !== "authored" ||
            implementation === undefined || genericArguments === undefined
          ? undefined
          : callableSubstitutions(implementation, genericArguments);
        const implementationParameters = selectedMethod?.kind === "spread"
          ? parameters
          : substitutions === undefined || implementation === undefined
            ? undefined
            : implementation.parameters.map((parameter) => substituteParameter(parameter, substitutions));
        const implementationResult = selectedMethod?.kind === "spread"
          ? resultType
          : substitutions === undefined || implementation === undefined
            ? undefined
            : substituteMojoTargetType(implementation.resultType, substitutions);
        const implementationError = selectedMethod?.kind === "spread"
          ? errorType
          : substitutions === undefined || implementation?.errorType === undefined
            ? undefined
            : substituteMojoTargetType(implementation.errorType, substitutions);
        if (selectedMethod === undefined || genericArguments === undefined ||
          parameters.some((parameter) => parameter === undefined) || resultType === undefined ||
          (variant.errorType !== undefined && errorType === undefined) ||
          implementationParameters === undefined || implementationResult === undefined ||
          selectedMethod.kind === "authored" && (
            implementation === undefined ||
            implementation.asynchronous !== variant.contract.asynchronous ||
            implementation.raises && !variant.raises ||
            implementation.raises && (
            implementationError === undefined || errorType === undefined ||
            !mojoTargetTypeEquals(implementationError, errorType)
            )
          )) {
          input.issues.push(Object.freeze({
            node: selectedMethod?.contribution.element ?? variant.contract.declaration,
            code: "MOJO_OBJECT_METHOD_DISPATCH_ABI_UNCLOSED",
            message: "An object-literal method does not close one exact selected interface dispatch ABI.",
          }));
          valid = false;
          continue;
        }
        const closedParameters = parameters as readonly MojoAnalyzedParameter[];
        const closedImplementationParameters = implementationParameters as readonly MojoAnalyzedParameter[];
        const parameterAdapters = selectMojoCallableParameterAdapters(
          closedParameters,
          closedImplementationParameters,
          input.relationships,
        );
        const resultConversion = classifyMojoValueConversion(
          implementationResult,
          resultType,
          undefined,
          input.relationships,
        );
        if (parameterAdapters === undefined || resultConversion.kind === "unsupported") {
          input.issues.push(Object.freeze({
            node: selectedMethod.contribution.element,
            code: "MOJO_OBJECT_METHOD_DISPATCH_CONVERSION_UNPROVEN",
            message: parameterAdapters === undefined
              ? "An object-literal method cannot exactly adapt its selected interface parameter carriers."
              : "An object-literal method cannot exactly adapt its selected interface result carrier.",
          }));
          valid = false;
          continue;
        }
        const methodCallableType = variant.property === undefined
          ? dispatchCallableType(
              variant.contract,
              closedParameters,
              resultType,
              errorType,
            )
          : input.relationships.instantiateType(
              view.definition,
              relationship.targetType,
              variant.property.callableType,
            );
        const writable = (selectedMethod.kind === "authored"
          ? selectedMethod.contribution.contractDeclarations
          : [selectedMethod.sourceDeclaration])
          .some((declaration) => input.methodPropertyUsages.get(declaration)?.writable === true);
        const requiresStorage = selectedMethod.kind === "spread" || writable;
        if ((requiresStorage && (methodCallableType === undefined ||
            methodCallableType.kind !== "callable")) ||
          (selectedMethod.kind === "spread" && variant.property?.read === undefined)) {
          input.issues.push(Object.freeze({
            node: selectedMethod.contribution.element,
            code: "MOJO_OBJECT_METHOD_PROPERTY_ABI_UNCLOSED",
            message: "An object-literal method property does not close one exact synchronous callable storage ABI.",
          }));
          valid = false;
          continue;
        }
        let methodStorage: import("../program/model.js").MojoProjectObjectLiteralMethodStorage | undefined;
        if (requiresStorage && methodCallableType?.kind === "callable") {
          const sourceDeclaration = selectedMethod.kind === "spread"
            ? selectedMethod.sourceDeclaration
            : undefined;
          let builder = methodStorageBuilders.find((candidate) =>
            candidate.identity === selectedMethod.contribution.element &&
            candidate.sourceDeclaration === sourceDeclaration);
          if (builder !== undefined &&
            !mojoTargetTypeEquals(builder.storage.callableType, methodCallableType)) {
            input.issues.push(Object.freeze({
              node: selectedMethod.contribution.element,
              code: "MOJO_OBJECT_METHOD_PROPERTY_ABI_CONFLICT",
              message: "One object-literal method property is exposed through incompatible callable storage ABIs.",
            }));
            valid = false;
            continue;
          }
          if (builder === undefined) {
            const declarations: Node[] = [];
            const storage = Object.freeze({
              declarations,
              name: allocateName(usedNames, `_method_${variant.name}`),
              callableType: methodCallableType,
              storageType: methodStorageType(methodCallableType),
              initialization: selectedMethod.kind === "spread"
                ? Object.freeze({
                    kind: "spread" as const,
                    contribution: selectedMethod.contribution,
                    declaration: selectedMethod.sourceDeclaration,
                  })
                : Object.freeze({ kind: "default" as const }),
            });
            builder = Object.freeze({
              identity: selectedMethod.contribution.element,
              ...(sourceDeclaration === undefined ? {} : { sourceDeclaration }),
              declarations,
              storage,
            });
            methodStorageBuilders.push(builder);
          }
          if (!builder.declarations.includes(variant.contract.declaration)) {
            builder.declarations.push(variant.contract.declaration);
          }
          methodStorage = builder.storage;
        }
        const adapterRaises = variant.raises || methodStorage?.callableType.raises === true;
        const adapterErrorType = methodStorage?.callableType.raises === true
          ? methodStorage.callableType.errorType
          : errorType;
        const adapterName = allocateName(
          usedNames,
          `_dispatch_${view.definition.targetName}_${variant.name}`,
        );
        const methodCallAdapterName = methodStorage === undefined
          ? undefined
          : allocateName(usedNames, `${adapterName}_current`);
        const methodBindAdapterName = variant.property?.read === undefined
          ? undefined
          : allocateName(usedNames, `${adapterName}_bound`);
        const methodReadAdapterName = variant.property?.read === undefined
          ? undefined
          : allocateName(usedNames, `${adapterName}_read`);
        const methodWriteAdapterName = variant.property?.write === undefined
          ? undefined
          : allocateName(usedNames, `${adapterName}_write`);
        callableAdapters.push(Object.freeze({
          variant,
          ...(implementation === undefined ? {} : { implementation }),
          genericArguments,
          parameters: Object.freeze(closedParameters),
          resultType,
          raises: adapterRaises,
          ...(adapterErrorType === undefined ? {} : { errorType: adapterErrorType }),
          parameterAdapters,
          resultConversion: resultConversion.conversion,
          adapterName,
          ...(methodStorage === undefined ? {} : { methodStorage }),
          ...(methodCallAdapterName === undefined ? {} : { methodCallAdapterName }),
          ...(methodBindAdapterName === undefined ? {} : { methodBindAdapterName }),
          ...(methodReadAdapterName === undefined ? {} : { methodReadAdapterName }),
          ...(methodWriteAdapterName === undefined ? {} : { methodWriteAdapterName }),
        }));
      }
      const fieldAdapters = view.fields.map((field) => createObjectLiteralFieldAdapter(
        field,
        view.definition,
        relationship.targetType,
        selection,
        getters,
        setters,
        input.callables,
        input.relationships,
        usedNames,
        storedFields,
      ));
      if (fieldAdapters.some((field) => field === undefined)) {
        input.issues.push(Object.freeze({
          node: expression,
          code: "MOJO_OBJECT_FIELD_DISPATCH_ABI_UNCLOSED",
          message: "A polymorphic object literal does not close every selected interface field or accessor ABI.",
        }));
        valid = false;
      }
      const indexAdapters = view.indexes.map((index) => {
        const selected = selection.indexSignatures.find(({ indexSignature }) =>
          indexSignature.declaration === index.indexSignature.declaration);
        if (selected === undefined) return undefined;
        const storageType = Object.freeze({
          kind: "dictionary" as const,
          key: selected.keyType,
          value: selected.valueType,
        });
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
        if (keyType === undefined || valueType === undefined ||
          !mojoTargetTypeEquals(keyType, storageType.key) ||
          !mojoTargetTypeEquals(valueType, storageType.value)) return undefined;
        return createIndexAdapter(
          index,
          selected.indexSignature.storageName,
          storageType,
          usedNames,
        );
      });
      if (indexAdapters.some((adapter) => adapter === undefined)) {
        input.issues.push(Object.freeze({
          node: expression,
          code: "MOJO_OBJECT_INDEX_DISPATCH_ABI_UNCLOSED",
          message: "A polymorphic object literal does not close every selected interface index ABI.",
        }));
        valid = false;
      }
      const downcastAdapters: MojoProjectDowncastAdapter[] = view.downcasts.map((route) =>
        Object.freeze({
          route,
          adapterName: allocateName(
            usedNames,
            `_dispatch_${view.definition.targetName}_${route.name}`,
          ),
          available: false,
        }));
      objectViews.push(Object.freeze({
        view,
        viewType: relationship.targetType,
        factoryName: allocateName(usedNames, `_view_as_${view.definition.targetName}`),
        callableAdapters: Object.freeze(callableAdapters),
        fieldAdapters: Object.freeze(fieldAdapters.filter(
          (field): field is NonNullable<typeof field> => field !== undefined,
        )),
        indexAdapters: Object.freeze(indexAdapters.filter(
          (adapter): adapter is MojoProjectDispatchIndexAdapter => adapter !== undefined,
        )),
        downcastAdapters: Object.freeze(downcastAdapters),
      }));
    }
    if (!valid || !objectViews.some((view) =>
      mojoTargetTypeEquals(view.viewType, selection.constructionType))) continue;
    for (const builder of methodStorageBuilders) Object.freeze(builder.declarations);
    const dispatch = Object.freeze({
      expression,
      selection,
      captures: Object.freeze([...capturesByDeclaration.values()]),
      views: Object.freeze(objectViews),
      methodStorages: Object.freeze(methodStorageBuilders.map(({ storage }) => storage)),
    });
    byExpression.set(expression, dispatch);
    plans.push(dispatch);
  }
  return Object.freeze({ byExpression, plans: Object.freeze(plans) });
}

function createObjectLiteralFieldAdapter(
  field: MojoProjectDispatchField,
  viewDefinition: MojoProjectTypeDefinition,
  viewType: MojoTargetTypeRef,
  selection: Extract<MojoObjectLiteralSelection, { readonly kind: "interface" }>,
  getters: readonly Extract<MojoObjectLiteralContribution, { readonly kind: "getter" }>[],
  setters: readonly Extract<MojoObjectLiteralContribution, { readonly kind: "setter" }>[],
  callables: WeakMap<Node, MojoCallableExpressionSelection>,
  relationships: MojoProjectTypeRelationships,
  names: Set<string>,
  storedFields: Map<Node, { readonly name: string; readonly type: MojoTargetTypeRef }>,
): import("../program/model.js").MojoProjectObjectLiteralFieldAdapter | undefined {
  const declarations = propertyDeclarations(field.property);
  const getterContribution = uniqueContribution(getters, declarations);
  const setterContribution = uniqueContribution(setters, declarations);
  const readType = field.read === undefined
    ? undefined
    : relationships.instantiateType(viewDefinition, viewType, field.read.valueType);
  const writeType = field.write === undefined
    ? undefined
    : relationships.instantiateType(viewDefinition, viewType, field.write.valueType);
  if ((field.read !== undefined && readType === undefined) ||
    (field.write !== undefined && writeType === undefined)) return undefined;
  if (getterContribution !== undefined || setterContribution !== undefined) {
    const readImplementation = getterContribution === undefined
      ? undefined
      : callables.get(getterContribution.element);
    const writeImplementation = setterContribution === undefined
      ? undefined
      : callables.get(setterContribution.element);
    const readConversion = readImplementation === undefined || readType === undefined
      ? undefined
      : classifyMojoValueConversion(
          readImplementation.resultType,
          readType,
          undefined,
          relationships,
        );
    const writeParameter = writeImplementation?.parameters[0];
    const writeConversion = writeParameter === undefined || writeType === undefined
      ? undefined
      : classifyMojoValueConversion(
          writeType,
          writeParameter.callType,
          undefined,
          relationships,
        );
    if ((field.read !== undefined && (readImplementation === undefined || readConversion?.kind !== "resolved")) ||
      (field.write !== undefined && (writeImplementation === undefined || writeConversion?.kind !== "resolved"))) {
      return undefined;
    }
    return Object.freeze({
      kind: "accessor",
      field,
      ...(readImplementation === undefined ? {} : { readImplementation }),
      ...(writeImplementation === undefined ? {} : { writeImplementation }),
      ...(readType === undefined ? {} : { readType }),
      ...(writeType === undefined ? {} : { writeType }),
      ...(readConversion?.kind === "resolved" ? { readResultConversion: readConversion.conversion } : {}),
      ...(writeConversion?.kind === "resolved" ? { writeValueConversion: writeConversion.conversion } : {}),
      ...(field.read === undefined ? {} : { readAdapterName: allocateName(names, `_read_${field.property.sourceName}`) }),
      ...(field.write === undefined ? {} : { writeAdapterName: allocateName(names, `_write_${field.property.sourceName}`) }),
    });
  }
  const contribution = [...selection.contributions].reverse().find((candidate) =>
    candidate.kind === "field" && propertyDeclarations(candidate.field).some((declaration) =>
      declarations.includes(declaration)));
  const selectedField = contribution?.kind === "field"
    ? contribution
    : selection.fields.find(({ field: candidate }) => declarations.includes(candidate.declaration));
  const storageType = selectedField === undefined
    ? undefined
    : "fieldType" in selectedField ? selectedField.fieldType : undefined;
  if (storageType === undefined) return undefined;
  const existingStorage = declarations.flatMap((declaration) => {
    const existing = storedFields.get(declaration);
    return existing === undefined ? [] : [existing];
  });
  const uniqueStorage = [...new Set(existingStorage)];
  if (uniqueStorage.length > 1 ||
    uniqueStorage[0] !== undefined && !mojoTargetTypeEquals(uniqueStorage[0].type, storageType)) {
    return undefined;
  }
  const storage = uniqueStorage[0] ?? Object.freeze({
    name: allocateName(names, field.property.sourceName),
    type: storageType,
  });
  for (const declaration of declarations) storedFields.set(declaration, storage);
  const readConversion = readType === undefined
    ? undefined
    : classifyMojoValueConversion(storageType, readType, undefined, relationships);
  const writeConversion = writeType === undefined
    ? undefined
    : classifyMojoValueConversion(writeType, storageType, undefined, relationships);
  if ((readType !== undefined && readConversion?.kind !== "resolved") ||
    (writeType !== undefined && writeConversion?.kind !== "resolved")) return undefined;
  return Object.freeze({
    kind: "stored",
    field,
    stateName: storage.name,
    storageType,
    ...(readType === undefined ? {} : { readType }),
    ...(writeType === undefined ? {} : { writeType }),
    ...(readConversion?.kind === "resolved" ? { readResultConversion: readConversion.conversion } : {}),
    ...(writeConversion?.kind === "resolved" ? { writeValueConversion: writeConversion.conversion } : {}),
    ...(field.read === undefined ? {} : { readAdapterName: allocateName(names, `_read_${field.property.sourceName}`) }),
    ...(field.write === undefined ? {} : { writeAdapterName: allocateName(names, `_write_${field.property.sourceName}`) }),
  });
}

function uniqueContribution<T extends { readonly contractDeclarations: readonly Node[] }>(
  contributions: readonly T[],
  declarations: readonly Node[],
): T | undefined {
  const matches = contributions.filter((contribution) =>
    contribution.contractDeclarations.some((declaration) => declarations.includes(declaration)));
  return matches.length === 1 ? matches[0] : undefined;
}

function mojoLocationType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.Location",
    modulePath: Object.freeze(["tsonic_runtime"]),
    name: "Location",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: value })]),
  });
}

interface MethodPropertyUsage {
  readonly declaration: Node;
  readonly readable: boolean;
  readonly writable: boolean;
  readonly callableTypes: readonly Extract<MojoTargetTypeRef, { readonly kind: "callable" }>[];
}

function collectMethodPropertyUsages(
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

function collectImplementationMethodPropertyUsages(
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

function createMethodProperty(
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

function dispatchCallableType(
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

function methodStorageType(
  callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
): Extract<MojoTargetTypeRef, { readonly kind: "optional" }> {
  return Object.freeze({ kind: "optional", value: callableType });
}

function collectDispatchRepresentationTypes(
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

function collectSelectedGenericArguments(
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

function relatedDefinitions(
  definition: MojoProjectTypeDefinition,
  relationships: MojoProjectTypeRelationships,
): readonly MojoProjectTypeDefinition[] {
  const source = relationships.openType(definition);
  return relationships.definitions.filter((candidate) =>
    relationships.relationship(source, candidate).kind === "related");
}

function callableContracts(
  analyzed: MojoAnalyzedClass | MojoAnalyzedInterface,
): readonly MojoAnalyzedCallableSignature[] {
  return analyzed.kind === "class"
    ? analyzed.callableContracts.filter((contract) => contract.kind === "method")
    : analyzed.methods;
}

function dispatchProperties(
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

function createCallableVariant(
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

function selectMethodPropertyCallableType(
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

function instantiateMemberParameter(
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

function instantiateParameterForType(
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

function createDispatchField(
  receiverType: MojoTargetTypeRef,
  property: MojoProjectDispatchField["property"],
  usedNames: Set<string>,
  relationships: MojoProjectTypeRelationships,
): MojoProjectDispatchField | undefined {
  const sourceName = property.sourceName;
  if (property.kind === "accessor-property") {
    const readType = property.read === undefined
      ? undefined
      : relationships.instantiateMemberType(
          property.read.declaration,
          receiverType,
          property.read.resultType,
        );
    const declaredWriteParameter = property.write?.parameters[0];
    const writeParameter = property.write === undefined || declaredWriteParameter === undefined
      ? undefined
      : instantiateMemberParameter(
          property.write,
          receiverType,
          declaredWriteParameter,
          relationships,
        );
    const readErrorType = property.read?.errorType === undefined
      ? undefined
      : relationships.instantiateMemberType(
          property.read.declaration,
          receiverType,
          property.read.errorType,
        );
    const writeErrorType = property.write?.errorType === undefined
      ? undefined
      : relationships.instantiateMemberType(
          property.write.declaration,
          receiverType,
          property.write.errorType,
        );
    if ((property.read !== undefined && readType === undefined) ||
      (declaredWriteParameter !== undefined && writeParameter === undefined) ||
      (property.read?.errorType !== undefined && readErrorType === undefined) ||
      (property.write?.errorType !== undefined && writeErrorType === undefined)) return undefined;
    return Object.freeze({
      property,
      ...(readType === undefined ? {} : {
        read: Object.freeze({
          name: property.read!.name,
          slotName: allocateName(usedNames, `_${sourceName}_read_dispatch`),
          slotType: functionType(
            [{ type: projectObjectType, convention: "imm", passing: "plain" }],
            readType,
            property.read!.asynchronous,
            property.read!.raises,
            readErrorType,
          ),
          valueType: readType,
        }),
      }),
      ...(writeParameter === undefined ? {} : {
        write: Object.freeze({
          name: property.write!.name,
          slotName: allocateName(usedNames, `_${sourceName}_write_dispatch`),
          slotType: functionType([
            { type: projectObjectType, convention: "imm", passing: "plain" },
            {
              type: writeParameter.bodyType,
              convention: mojoParameterConvention(writeParameter.disposition),
              passing: writeParameter.disposition.kind === "owned" ? "consume" : "plain",
            },
          ], { kind: "unit" }, property.write!.asynchronous, property.write!.raises, writeErrorType),
          valueType: writeParameter.callType,
          disposition: writeParameter.disposition,
        }),
      }),
    });
  }
  const propertyType = relationships.instantiateMemberType(
    property.declaration,
    receiverType,
    property.type,
  );
  if (propertyType === undefined) return undefined;
  const readName = allocateName(usedNames, `get_${sourceName}`);
  const writeName = allocateName(usedNames, `set_${sourceName}`);
  return Object.freeze({
    property,
    read: Object.freeze({
      name: readName,
      slotName: allocateName(usedNames, `_${sourceName}_read_dispatch`),
      slotType: functionType(
        [{ type: projectObjectType, convention: "imm", passing: "plain" }],
        propertyType,
        false,
        false,
      ),
      valueType: propertyType,
    }),
    ...(property.kind === "interface-field" && property.readonly
      ? {}
      : {
          write: Object.freeze({
            name: writeName,
            slotName: allocateName(usedNames, `_${sourceName}_write_dispatch`),
            slotType: functionType([
              { type: projectObjectType, convention: "imm", passing: "plain" },
              { type: propertyType, convention: "imm", passing: "plain" },
            ], { kind: "unit" }, false, false),
            valueType: propertyType,
          }),
        }),
  });
}

function createDispatchIndex(
  receiverType: MojoTargetTypeRef,
  indexSignature: import("../program/model.js").MojoAnalyzedInterfaceIndexSignature,
  usedNames: Set<string>,
  relationships: MojoProjectTypeRelationships,
): MojoProjectDispatchIndex | undefined {
  const keyType = relationships.instantiateMemberType(
    indexSignature.declaration,
    receiverType,
    indexSignature.keyType,
  );
  const valueType = relationships.instantiateMemberType(
    indexSignature.declaration,
    receiverType,
    indexSignature.valueType,
  );
  if (keyType === undefined || valueType === undefined) return undefined;
  const storageType = Object.freeze({
    kind: "dictionary" as const,
    key: keyType,
    value: valueType,
  });
  const read: MojoProjectDispatchIndex["read"] = Object.freeze({
    name: allocateName(usedNames, "get_index"),
    slotName: allocateName(usedNames, "_index_read_dispatch"),
    slotType: functionType([
      { type: projectObjectType, convention: "imm", passing: "plain" },
      { type: keyType, convention: "imm", passing: "plain" },
    ], valueType, false, false),
  });
  const write: MojoProjectDispatchIndex["write"] = indexSignature.readonly
    ? undefined
    : Object.freeze({
        name: allocateName(usedNames, "set_index"),
        slotName: allocateName(usedNames, "_index_write_dispatch"),
        slotType: functionType([
          { type: projectObjectType, convention: "imm", passing: "plain" },
          { type: keyType, convention: "imm", passing: "plain" },
          { type: valueType, convention: "imm", passing: "plain" },
        ], { kind: "unit" }, false, false),
      });
  return Object.freeze({
    indexSignature,
    keyType,
    valueType,
    read,
    ...(write === undefined ? {} : { write }),
    copy: Object.freeze({
      name: allocateName(usedNames, "copy_index_into"),
      slotName: allocateName(usedNames, "_index_copy_dispatch"),
      slotType: functionType([
        { type: projectObjectType, convention: "imm", passing: "plain" },
        { type: storageType, convention: "mut", passing: "plain" },
      ], { kind: "unit" }, false, false),
    }),
  });
}

function createIndexAdapter(
  index: MojoProjectDispatchIndex,
  storageName: string,
  storageType: Extract<MojoTargetTypeRef, { readonly kind: "dictionary" }>,
  usedNames: Set<string>,
): MojoProjectDispatchIndexAdapter {
  const baseName = index.indexSignature.storageName;
  return Object.freeze({
    index,
    storageName,
    storageType,
    readAdapterName: allocateName(usedNames, `${baseName}_read_adapter`),
    ...(index.write === undefined
      ? {}
      : { writeAdapterName: allocateName(usedNames, `${baseName}_write_adapter`) }),
    copyAdapterName: allocateName(usedNames, `${baseName}_copy_adapter`),
  });
}

function createFieldAdapter(
  field: MojoProjectDispatchField,
  concrete: MojoAnalyzedClass,
  viewDefinition: MojoProjectTypeDefinition,
  viewType: MojoTargetTypeRef,
  relationships: MojoProjectTypeRelationships,
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
  propertiesByDeclaration: WeakMap<Node, MojoProjectDispatchField["property"]>,
  names: Set<string>,
): MojoProjectDispatchFieldAdapter | undefined {
  const readType = field.read === undefined
    ? undefined
    : relationships.instantiateType(viewDefinition, viewType, field.read.valueType);
  const writeType = field.write === undefined
    ? undefined
    : relationships.instantiateType(viewDefinition, viewType, field.write.valueType);
  if (field.read !== undefined && readType === undefined ||
    field.write !== undefined && writeType === undefined) return undefined;
  const declaration = propertyDeclarations(field.property)[0];
  if (declaration === undefined) return undefined;
  const selected = relationships.memberImplementation(concrete.definition, declaration);
  if (selected.kind !== "resolved") return undefined;
  const selectedDeclaration = selected.implementation.declaration;
  const selectedProperty = propertiesByDeclaration.get(selectedDeclaration);
  const kind = selectedProperty?.kind;
  if (kind === "instance-field" || kind === "interface-field") {
    const storedProperty = selectedProperty as Extract<
      MojoProjectDispatchField["property"],
      { readonly kind: "instance-field" | "interface-field" }
    >;
    const owner = relationships.definitionContainingDeclaration(storedProperty.declaration);
    const lineage = relationships.classLineage(concrete.definition);
    const ownerIndex = owner === undefined || lineage === undefined
      ? -1
      : lineage.indexOf(owner);
    const ownerRelationship = owner === undefined
      ? undefined
      : relationships.relationship(concrete.targetType, owner);
    const storageType = ownerRelationship?.kind === "related"
      ? relationships.instantiateMemberType(
          storedProperty.declaration,
          ownerRelationship.targetType,
          storedProperty.type,
        )
      : undefined;
    const readConversion = storageType === undefined || readType === undefined
      ? undefined
      : classifyMojoValueConversion(storageType, readType, undefined, relationships);
    const writeConversion = storageType === undefined || writeType === undefined
      ? undefined
      : classifyMojoValueConversion(writeType, storageType, undefined, relationships);
    if (storedProperty.kind !== "instance-field" || ownerIndex < 0 || storageType === undefined ||
      readConversion?.kind === "unsupported" || writeConversion?.kind === "unsupported") return undefined;
    return Object.freeze({
      kind: "stored",
      field,
      ...(field.read === undefined ? {} : { readAdapterName: allocateName(names, `_read_${field.property.sourceName}`) }),
      ...(field.write === undefined ? {} : { writeAdapterName: allocateName(names, `_write_${field.property.sourceName}`) }),
      statePath: Object.freeze([
        ...Array.from({ length: lineage!.length - ownerIndex - 1 }, () => "_base"),
        storedProperty.name,
      ]),
      storageType,
      ...(readType === undefined ? {} : { readType }),
      ...(writeType === undefined ? {} : { writeType }),
      ...(readConversion?.kind === "resolved"
        ? { readResultConversion: readConversion.conversion }
        : {}),
      ...(writeConversion?.kind === "resolved"
        ? { writeValueConversion: writeConversion.conversion }
        : {}),
    });
  }
  const readDeclaration = field.property.kind === "accessor-property"
    ? field.property.read?.declaration
    : undefined;
  const writeDeclaration = field.property.kind === "accessor-property"
    ? field.property.write?.declaration
    : undefined;
  const readImplementation = readDeclaration === undefined
    ? undefined
    : implementationForContract(concrete, readDeclaration, relationships, implementations);
  const writeImplementation = writeDeclaration === undefined
    ? undefined
    : implementationForContract(concrete, writeDeclaration, relationships, implementations);
  const ownerDeclaration = readImplementation?.declaration ?? writeImplementation?.declaration;
  const owner = relationships.definitionContainingDeclaration(ownerDeclaration);
  const ownerRelation = owner === undefined ? undefined : relationships.relationship(concrete.targetType, owner);
  if (ownerRelation?.kind !== "related") return undefined;
  const readImplementationResult = readImplementation === undefined
    ? undefined
    : relationships.instantiateMemberType(
        readImplementation.declaration,
        ownerRelation.targetType,
        readImplementation.resultType,
      );
  const writeImplementationParameter = writeImplementation?.parameters[0] === undefined
    ? undefined
    : instantiateMemberParameter(
        writeImplementation,
        ownerRelation.targetType,
        writeImplementation.parameters[0],
        relationships,
      );
  const readConversion = readImplementationResult === undefined || readType === undefined
    ? undefined
    : classifyMojoValueConversion(
        readImplementationResult,
        readType,
        undefined,
        relationships,
      );
  const writeConversion = writeImplementationParameter === undefined || writeType === undefined
    ? undefined
    : classifyMojoValueConversion(
        writeType,
        writeImplementationParameter.callType,
        undefined,
        relationships,
      );
  if (field.read !== undefined && (readImplementation === undefined ||
      readConversion?.kind !== "resolved" ||
      readImplementation.asynchronous !== field.read.slotType.asynchronous ||
      readImplementation.raises && !field.read.slotType.raises) ||
    field.write !== undefined && (writeImplementation === undefined ||
      writeImplementationParameter === undefined || writeConversion?.kind !== "resolved" ||
      mojoParameterConvention(writeImplementationParameter.disposition) !==
        mojoParameterConvention(field.write.disposition ?? Object.freeze({
          kind: "immutable",
          localCopy: false,
        })) ||
      writeImplementation.asynchronous !== field.write.slotType.asynchronous ||
      writeImplementation.raises && !field.write.slotType.raises)) return undefined;
  return Object.freeze({
    kind: "accessor",
    field,
    ...(field.read === undefined ? {} : { readAdapterName: allocateName(names, `_read_${field.property.sourceName}`) }),
    ...(field.write === undefined ? {} : { writeAdapterName: allocateName(names, `_write_${field.property.sourceName}`) }),
    ...(readImplementation === undefined ? {} : { readImplementation }),
    ...(writeImplementation === undefined ? {} : { writeImplementation }),
    implementationOwnerType: ownerRelation.targetType,
    ...(readType === undefined ? {} : { readType }),
    ...(writeType === undefined ? {} : { writeType }),
    ...(readConversion?.kind === "resolved"
      ? { readResultConversion: readConversion.conversion }
      : {}),
    ...(writeConversion?.kind === "resolved"
      ? { writeValueConversion: writeConversion.conversion }
      : {}),
    ...(writeImplementationParameter === undefined ? {} : { writeImplementationParameter }),
  });
}

function createPropertyIndex(
  classes: readonly MojoAnalyzedClass[],
  interfaces: readonly MojoAnalyzedInterface[],
): WeakMap<Node, MojoProjectDispatchField["property"]> {
  const index = new WeakMap<Node, MojoProjectDispatchField["property"]>();
  for (const class_ of classes) {
    for (const property of [...class_.fields, ...class_.accessorProperties]) {
      for (const declaration of propertyDeclarations(property)) index.set(declaration, property);
    }
  }
  for (const interface_ of interfaces) {
    for (const property of [...interface_.fields, ...interface_.accessorProperties]) {
      for (const declaration of propertyDeclarations(property)) index.set(declaration, property);
    }
  }
  return index;
}

function implementationForContract(
  concrete: MojoAnalyzedClass,
  declaration: Node,
  relationships: MojoProjectTypeRelationships,
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
): MojoAnalyzedFunction | undefined {
  const selected = relationships.memberImplementation(concrete.definition, declaration);
  return selected.kind === "resolved"
    ? implementations.get(selected.implementation.declaration)
    : undefined;
}

function createImplementationNames(
  classes: readonly MojoAnalyzedClass[],
  views: readonly MojoProjectDispatchView[],
  relationships: MojoProjectTypeRelationships,
  specializations: MojoSourceCallableSpecializationPlan,
): {
  readonly implementations: WeakMap<Node, string>;
  readonly usedByClass: Map<MojoProjectTypeDefinition, Set<string>>;
} {
  const implementations = new WeakMap<Node, string>();
  const usedByClass = new Map<MojoProjectTypeDefinition, Set<string>>();
  for (const class_ of classes) {
    const used = new Set<string>([
      "__init__",
      "__eq__",
      ...(class_.errorRole === "typed" ? ["write_to"] : []),
      ...class_.fields.map((field) => field.name),
      ...class_.methods.filter((method) => method.static === true).map((method) => method.name),
      ...class_.accessors.filter((accessor) => accessor.static === true).map((accessor) => accessor.name),
    ]);
    for (const view of views) {
      if (relationships.relationship(class_.targetType, view.definition).kind !== "related") continue;
      for (const callable of view.callables) used.add(callable.name);
      for (const field of view.fields) {
        if (field.read !== undefined) used.add(field.read.name);
        if (field.write !== undefined) used.add(field.write.name);
      }
      for (const index of view.indexes) {
        used.add(index.read.name);
        if (index.write !== undefined) used.add(index.write.name);
        used.add(index.copy.name);
      }
      for (const downcast of view.downcasts) used.add(downcast.name);
      for (const conversion of view.conversions) used.add(conversion.name);
    }
    for (const implementation of [...class_.methods, ...class_.accessors]) {
      if (implementation.static === true) continue;
      if (specializations.requiresSpecialization(implementation.declaration)) {
        for (const variant of specializations.variantsForCallable(implementation.declaration)) {
          used.add(variant.targetName);
        }
        continue;
      }
      implementations.set(
        implementation.declaration,
        allocateName(used, `_implement_${implementation.name}`),
      );
    }
    usedByClass.set(class_.definition, used);
  }
  return Object.freeze({ implementations, usedByClass });
}

function callableSubstitutions(
  contract: Pick<MojoAnalyzedCallableSignature, "typeParameters">,
  genericArguments: readonly MojoTargetGenericArgument[],
): MojoTargetTypeSubstitutions | undefined {
  if (contract.typeParameters.length !== genericArguments.length) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  for (const [index, parameter] of contract.typeParameters.entries()) {
    const argument = genericArguments[index];
    if (parameter.kind === "type" && argument?.kind === "type") {
      types.set(parameter.name, argument.type);
      types.set(parameter.identity, argument.type);
    } else if (parameter.kind === "origin" && argument?.kind === "origin") {
      origins.set(parameter.name, argument.origin);
      origins.set(parameter.identity, argument.origin);
    }
    else if (parameter.kind === "value" && argument !== undefined &&
      argument.kind !== "type" && argument.kind !== "type-expression" &&
      argument.kind !== "origin" && argument.kind !== "unbound") {
      values.set(parameter.name, argument);
      values.set(parameter.identity, argument);
    }
    else return undefined;
  }
  return Object.freeze({ types, values, origins, packs: new Map() });
}

function substituteParameter(
  parameter: MojoAnalyzedParameter,
  substitutions: MojoTargetTypeSubstitutions,
): MojoAnalyzedParameter {
  return Object.freeze({
    ...parameter,
    type: substituteMojoTargetType(parameter.type, substitutions),
    bodyType: substituteMojoTargetType(parameter.bodyType, substitutions),
    callType: substituteMojoTargetType(parameter.callType, substitutions),
  });
}

function functionType(
  parameters: Extract<MojoTargetTypeRef, { readonly kind: "function" }>["parameters"],
  result: MojoTargetTypeRef,
  asynchronous: boolean,
  raises: boolean,
  errorType?: MojoTargetTypeRef,
): Extract<MojoTargetTypeRef, { readonly kind: "function" }> {
  return Object.freeze({
    kind: "function",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(parameters),
    result,
    asynchronous,
    thin: true,
    raises,
    ...(errorType === undefined ? {} : { errorType }),
  });
}

function genericArgumentsCloseOverView(
  arguments_: readonly MojoTargetGenericArgument[],
  definition: MojoProjectTypeDefinition,
): boolean {
  const allowed = new Set(definition.typeParameters.flatMap((parameter) => [parameter.name, parameter.identity]));
  const referenced = new Set<string>();
  for (const argument of arguments_) collectGenericArgumentParameters(argument, referenced);
  return [...referenced].every((name) => allowed.has(name));
}

function collectGenericArgumentParameters(
  argument: MojoTargetGenericArgument,
  output: Set<string>,
): void {
  if (argument.kind === "type") collectTypeParameters(argument.type, output);
  else if (argument.kind === "value-reference" && argument.path.length === 1) output.add(argument.path[0]!);
  else if (argument.kind === "origin" && argument.origin.kind === "parameter") output.add(argument.origin.name);
}

function collectTypeParameters(type: MojoTargetTypeRef, output: Set<string>): void {
  if (type.kind === "type-parameter") {
    output.add(type.identity ?? type.name);
    output.add(type.name);
    return;
  }
  switch (type.kind) {
    case "target-named":
      for (const argument of type.genericArguments ?? []) collectGenericArgumentParameters(argument, output);
      return;
    case "list":
    case "fixed-array": collectTypeParameters(type.element, output); return;
    case "dictionary": collectTypeParameters(type.key, output); collectTypeParameters(type.value, output); return;
    case "future": collectTypeParameters(type.output, output); return;
    case "optional":
    case "reference": collectTypeParameters(type.value, output); return;
    case "union": for (const member of type.members) collectTypeParameters(member, output); return;
    case "tuple": for (const element of type.elements) collectTypeParameters(element, output); return;
    case "associated":
      collectTypeParameters(type.owner, output);
      for (const argument of type.genericArguments) collectGenericArgumentParameters(argument, output);
      return;
    case "callable":
    case "function":
      for (const parameter of type.parameters) collectTypeParameters(parameter.type, output);
      collectTypeParameters(type.result, output);
      if (type.errorType !== undefined) collectTypeParameters(type.errorType, output);
      return;
    default: return;
  }
}

function propertyDeclarations(property: MojoProjectDispatchField["property"]): readonly Node[] {
  return property.kind === "accessor-property" ? property.declarations : [property.declaration];
}

function sameProperty(
  left: MojoProjectDispatchField["property"],
  right: MojoProjectDispatchField["property"],
): boolean {
  const rightDeclarations = propertyDeclarations(right);
  return propertyDeclarations(left).some((declaration) => rightDeclarations.includes(declaration));
}

function allocateName(used: Set<string>, requested: string): string {
  let candidate = requested;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${requested}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
