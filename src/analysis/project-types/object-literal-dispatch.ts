import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedParameter,
  MojoProjectDowncastAdapter,
  MojoProjectDispatchField,
  MojoProjectDispatchIndexAdapter,
  MojoProjectDispatchView,
  MojoProjectObjectLiteralDispatch,
  MojoObjectLiteralSelection,
  MojoObjectLiteralContribution,
  MojoCallableExpressionSelection,
} from "../program/model.js";
import type {
  MojoProjectTypeDefinition,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type {
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { selectMojoCallableParameterAdapters } from "../callables/parameter-adapters.js";

import {
  dispatchCallableType,
  instantiateParameterForType,
  methodStorageType,
} from "./dispatch-callables.js";
import type { MethodPropertyUsage } from "./dispatch-callables.js";
import { createIndexAdapter } from "./dispatch-fields.js";
import {
  allocateName,
  callableSubstitutions,
  propertyDeclarations,
  substituteParameter,
} from "./dispatch-support.js";

export function createObjectLiteralDispatchPlans(input: {
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

export function createObjectLiteralFieldAdapter(
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

export function uniqueContribution<T extends { readonly contractDeclarations: readonly Node[] }>(
  contributions: readonly T[],
  declarations: readonly Node[],
): T | undefined {
  const matches = contributions.filter((contribution) =>
    contribution.contractDeclarations.some((declaration) => declarations.includes(declaration)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function mojoLocationType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.Location",
    modulePath: Object.freeze(["tsonic_runtime"]),
    name: "Location",
    genericArguments: Object.freeze([Object.freeze({ kind: "type", type: value })]),
  });
}
