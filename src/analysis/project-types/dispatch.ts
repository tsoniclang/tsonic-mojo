import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoProjectDowncastRoute,
  MojoProjectDispatchCallableVariant,
  MojoProjectDispatchField,
  MojoProjectDispatchIndex,
  MojoProjectDispatchPlan,
  MojoProjectDispatchView,
  MojoObjectLiteralSelection,
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
import type { MojoSourceCallableSpecializationPlan } from "../callables/specializations.js";
import { createConcreteDispatchPlans } from "./concrete-dispatch.js";
import { createObjectLiteralDispatchPlans } from "./object-literal-dispatch.js";
import {
  callableContracts,
  collectDispatchRepresentationTypes,
  collectImplementationMethodPropertyUsages,
  collectMethodPropertyUsages,
  collectSelectedGenericArguments,
  createCallableVariant,
  dispatchProperties,
  relatedDefinitions,
} from "./dispatch-callables.js";
import {
  createDispatchField,
  createDispatchIndex,
  createPropertyIndex,
} from "./dispatch-fields.js";
import {
  allocateName,
  createImplementationNames,
  functionType,
  genericArgumentsCloseOverView,
  projectObjectType,
  optionalProjectObjectType,
  propertyDeclarations,
  samePath,
  sameProperty,
} from "./dispatch-support.js";

const maximumDispatchEntries = 1_048_576;
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
  const concreteDispatch = createConcreteDispatchPlans({
    classes: input.classes,
    relationships: input.relationships,
    implementations: input.implementations,
    sourceCallableSpecializations: input.sourceCallableSpecializations,
    views,
    implementationNames,
    usedNamesByClass: generatedNames.usedByClass,
    implementationMethodPropertyUsages,
    propertiesByDeclaration,
    issues,
  });

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
