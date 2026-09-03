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
  MojoProjectDispatchCallableAdapter,
  MojoProjectDispatchCallableVariant,
  MojoProjectDispatchField,
  MojoProjectDispatchFieldAdapter,
  MojoProjectDispatchPlan,
  MojoProjectDispatchView,
  MojoCallSelection,
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

const maximumDispatchEntries = 1_048_576;
const projectObjectType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "tsonic.mojo.runtime.ProjectObject",
  modulePath: Object.freeze(["tsonic_runtime"]),
  name: "ProjectObject",
});

export function createMojoProjectDispatchPlan(input: {
  readonly classes: readonly MojoAnalyzedClass[];
  readonly interfaces: readonly MojoAnalyzedInterface[];
  readonly relationships: MojoProjectTypeRelationships;
  readonly callNodes: ReadonlySet<Node>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly implementations: WeakMap<Node, MojoAnalyzedFunction>;
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
    input.callNodes,
    input.callSelections,
  );
  const propertiesByDeclaration = createPropertyIndex(input.classes, input.interfaces);
  const views: MojoProjectDispatchView[] = [];
  let entryCount = 0;

  for (const analyzed of [...input.classes, ...input.interfaces]) {
    if (!analyzed.polymorphic) continue;
    const usedNames = new Set<string>();
    const callables: MojoProjectDispatchCallableVariant[] = [];
    const fields: MojoProjectDispatchField[] = [];
    const related = relatedDefinitions(analyzed.definition, input.relationships)
      .map((definition) => analyzedByDefinition.get(definition))
      .filter((value): value is MojoAnalyzedClass | MojoAnalyzedInterface => value !== undefined);

    for (const owner of related) {
      for (const contract of callableContracts(owner)) {
        if (contract.static === true || contract.kind === "constructor") continue;
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
    }

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
        if (concreteGenericArguments === undefined ||
          concreteParameters.some((parameter) => parameter === undefined) ||
          concreteResult === undefined ||
          (variant.errorType !== undefined && concreteError === undefined)) {
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
        const implementationName = implementationNames.get(selected.implementation.declaration);
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
        if (implementationParameters === undefined ||
          implementationParameters.some((parameter) => parameter === undefined) ||
          implementationParameters.length !== closedConcreteParameters.length ||
          closedImplementationResult === undefined ||
          implementation.asynchronous !== variant.contract.asynchronous ||
          implementation.raises && !variant.contract.raises ||
          implementation.raises && (
            (closedImplementationError === undefined) !== (concreteError === undefined) ||
            closedImplementationError !== undefined && concreteError !== undefined &&
              !mojoTargetTypeEquals(closedImplementationError, concreteError)
          )) {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_DISPATCH_IMPLEMENTATION_ABI_UNCLOSED",
            message: `Concrete class '${concrete.name}' has no exact closed ABI for the selected project method contract.`,
          }));
          continue;
        }
        const closedImplementationParameters = implementationParameters as readonly MojoAnalyzedParameter[];
        const argumentConversions = closedConcreteParameters.map((parameter, index) => {
          const target = closedImplementationParameters[index]!;
          if (mojoParameterConvention(parameter.disposition) !==
            mojoParameterConvention(target.disposition)) return undefined;
          const conversion = classifyMojoValueConversion(
            parameter.bodyType,
            target.callType,
            undefined,
            input.relationships,
          );
          return conversion.kind === "resolved" ? conversion.conversion : undefined;
        });
        const resultConversion = classifyMojoValueConversion(
          closedImplementationResult,
          concreteResult,
          undefined,
          input.relationships,
        );
        if (argumentConversions.some((conversion) => conversion === undefined) ||
          resultConversion.kind === "unsupported") {
          issues.push(Object.freeze({
            node: variant.contract.declaration,
            code: "MOJO_PROJECT_DISPATCH_IMPLEMENTATION_CONVERSION_UNPROVEN",
            message: `Concrete class '${concrete.name}' cannot exactly adapt the selected project method implementation ABI.`,
          }));
          continue;
        }
        callableAdapters.push(Object.freeze({
          variant,
          genericArguments: concreteGenericArguments,
          parameters: Object.freeze(closedConcreteParameters),
          resultType: concreteResult,
          ...(concreteError === undefined ? {} : { errorType: concreteError }),
          adapterName: allocateName(adapterNames, `_dispatch_${view.definition.targetName}_${variant.name}`),
          implementationName,
          implementation,
          implementationOwnerType: implementationRelation.targetType,
          implementationParameters: Object.freeze(closedImplementationParameters),
          argumentConversions: Object.freeze(argumentConversions as readonly import("../../target-model/conversions/model.js").MojoValueConversion[]),
          resultConversion: resultConversion.conversion,
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
      concreteViews.push(Object.freeze({
        view,
        viewType: relationship.targetType,
        conversionAdapterName: allocateName(adapterNames, `_view_as_${view.definition.targetName}`),
        callableAdapters: Object.freeze(callableAdapters),
        fieldAdapters: Object.freeze(fieldAdapters.filter(
          (adapter): adapter is MojoProjectDispatchFieldAdapter => adapter !== undefined,
        )),
      }));
    }
    concreteDispatch.set(concrete.definition, Object.freeze({
      concrete,
      views: Object.freeze(concreteViews),
    }));
  }

  const plan: MojoProjectDispatchPlan = {
    issues: Object.freeze(issues),
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
    implementationName(declaration) {
      return implementationNames.get(declaration);
    },
  };
  return Object.freeze(plan);
}

function collectSelectedGenericArguments(
  nodes: ReadonlySet<Node>,
  selections: WeakMap<Node, MojoCallSelection>,
): WeakMap<Node, readonly (readonly MojoTargetGenericArgument[])[]> {
  const pending = new WeakMap<Node, MojoTargetGenericArgument[][]>();
  for (const node of nodes) {
    const selection = selections.get(node);
    if (selection?.kind !== "project" || selection.target.kind !== "method" ||
      selection.genericArguments.length === 0) continue;
    const current = pending.get(selection.target.declaration) ?? [];
    if (!current.some((arguments_) =>
      mojoTargetGenericArgumentsEqual(arguments_, selection.genericArguments))) {
      current.push([...selection.genericArguments]);
    }
    pending.set(selection.target.declaration, current);
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
    ? analyzed.callableContracts
    : [...analyzed.methods, ...analyzed.accessors];
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
  return Object.freeze({
    contract,
    genericArguments: Object.freeze([...genericArguments]),
    name,
    slotName,
    slotType: functionType([
      { type: projectObjectType, convention: "imm", passing: "plain" },
      ...closedParameters.map((parameter) => ({
        type: parameter.bodyType,
        convention: mojoParameterConvention(parameter.disposition),
        passing: parameter.disposition.kind === "owned" ? "consume" as const : "plain" as const,
      })),
    ], resultType, contract.asynchronous, contract.raises, errorType),
    parameters: closedParameters,
    resultType,
    ...(errorType === undefined ? {} : { errorType }),
  });
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
      for (const conversion of view.conversions) used.add(conversion.name);
    }
    for (const implementation of [...class_.methods, ...class_.accessors]) {
      if (implementation.static === true) continue;
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
  contract: MojoAnalyzedCallableSignature,
  genericArguments: readonly MojoTargetGenericArgument[],
): MojoTargetTypeSubstitutions | undefined {
  if (contract.typeParameters.length !== genericArguments.length) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  for (const [index, parameter] of contract.typeParameters.entries()) {
    const argument = genericArguments[index];
    if (parameter.kind === "type" && argument?.kind === "type") types.set(parameter.name, argument.type);
    else if (parameter.kind === "origin" && argument?.kind === "origin") origins.set(parameter.name, argument.origin);
    else if (parameter.kind === "value" && argument !== undefined &&
      argument.kind !== "type" && argument.kind !== "type-expression" &&
      argument.kind !== "origin" && argument.kind !== "unbound") values.set(parameter.name, argument);
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
