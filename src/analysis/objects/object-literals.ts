import type { Node, SourceFile } from "@tsonic/tsts";
import {
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
  selectSourceObjectLiteralAccessors,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedClassOwner,
  MojoAnalyzedProjectCallable,
  MojoCallableExpressionSelection,
  MojoAnalyzedProjectProperty,
  MojoObjectLiteralContribution,
  MojoObjectLiteralSelection,
} from "../program/model.js";
import {
  instantiateAccessorProperty,
  instantiateInterfaceClosure,
  objectIndexKey,
  rejectObjectLiteral as reject,
  selectConstructionType,
  uniqueAccessorProperties,
  uniqueCallableContracts,
} from "./object-literal-closure.js";
import { selectMojoProjectConstruction } from "../project-types/construction.js";

export interface MojoObjectLiteralAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
  readonly expression: Node;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expectedType?: MojoTargetTypeRef;
  readonly interfaceByTypeId: ReadonlyMap<string, MojoAnalyzedInterface>;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
  readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
  readonly analyzeCallable: (
    element: Node,
    selectedType: import("@tsonic/tsts").Type,
    kind: "method" | "getter" | "setter",
    name: string,
    owner: MojoAnalyzedClassOwner,
  ) => MojoCallableExpressionSelection | undefined;
  readonly analyzeCallableValue: (
    expression: Node,
    selectedType: import("@tsonic/tsts").Type,
  ) => MojoCallableExpressionSelection | undefined;
  readonly resolveType: (type: import("@tsonic/tsts").Type | undefined) => MojoTargetTypeRef | undefined;
  readonly diagnostics: TargetDiagnostic[];
}

export function analyzeMojoObjectLiteral(
  input: MojoObjectLiteralAnalysisInput,
): MojoObjectLiteralSelection | undefined {
  const { source, expression } = input;
  const { ast } = source;
  if (!ast.is.IsObjectLiteralExpression(expression)) return undefined;
  const semantics = source.semantics.forFile(input.sourceFile);
  const contextualSelection = semantics.types.contextualValueSelection(expression);
  const contextualType = contextualSelection.kind === "selected"
    ? input.resolveType(contextualSelection.type)
    : undefined;
  const inferredType = input.expressionTypes.get(expression);
  const resultType = input.expectedType ?? contextualType ?? inferredType;
  const constructionType = selectConstructionType(
    resultType,
    contextualType,
    inferredType,
    expression,
    input,
    semantics,
  );
  const interface_ = constructionType?.kind === "target-named"
    ? input.interfaceByTypeId.get(constructionType.id)
    : undefined;
  if (resultType === undefined || constructionType === undefined || interface_ === undefined) return undefined;
  const construction = selectMojoProjectConstruction(interface_, constructionType);
  if (construction === undefined) {
    reject(
      input,
      "MOJO_OBJECT_CONSTRUCTION_NOT_SEALED",
      "Object literal lowering has no exact sealed Mojo construction route.",
      expression,
    );
    return undefined;
  }
  const resultConversion = classifyMojoValueConversion(constructionType, resultType);
  if (resultConversion.kind === "unsupported") {
    reject(input, "MOJO_OBJECT_RESULT_CONVERSION_UNPROVEN", resultConversion.reason, expression);
    return undefined;
  }
  const instantiatedClosure = instantiateInterfaceClosure(constructionType, input);
  const instantiatedFields = instantiatedClosure?.fields;
  if (instantiatedFields === undefined) {
    reject(input, "MOJO_OBJECT_INTERFACE_INSTANTIATION_UNRESOLVED", "Object literal interface arguments do not exactly instantiate its declared fields.", expression);
    return undefined;
  }
  const fieldTypes = new Map(instantiatedFields.map((field) => [field.field.declaration, field] as const));
  const instantiatedIndexSignatures = instantiatedClosure?.indexSignatures;
  const instantiatedMethods = instantiatedClosure?.methods;
  if (instantiatedIndexSignatures === undefined || instantiatedMethods === undefined) {
    reject(input, "MOJO_OBJECT_INDEX_INSTANTIATION_UNRESOLVED", "Object literal interface arguments do not exactly instantiate its declared index signatures.", expression);
    return undefined;
  }
  const indexTypes = new Map(instantiatedIndexSignatures.map((entry) => [entry.indexSignature.declaration, entry] as const));
  const owner = Object.freeze({
    name: interface_.name,
    stateName: interface_.stateName,
    type: constructionType,
  });
  const accessorSelection = selectSourceObjectLiteralAccessors(ast, semantics, expression);
  if (accessorSelection.kind === "rejected") {
    reject(
      input,
      "MOJO_OBJECT_ACCESSOR_SELECTION_UNRESOLVED",
      accessorSelection.reason,
      accessorSelection.element,
    );
    return undefined;
  }
  const accessors = new Map<Node, {
    readonly kind: "getter" | "setter";
    readonly selectedType: import("@tsonic/tsts").Type;
    readonly contractDeclarations: readonly Node[];
    readonly name: string;
  }>();
  const accessorAssignments = new Set<Node>();
  if (accessorSelection.kind === "resolved") {
    for (const member of accessorSelection.members) {
      const properties = uniqueAccessorProperties(
        member.sourceSelectedDeclarations,
        input.fieldByDeclaration,
      );
      const property = properties.length === 1 ? properties[0] : undefined;
      if (property === undefined) {
        reject(
          input,
          "MOJO_OBJECT_ACCESSOR_CONTRACT_UNRESOLVED",
          "Object-literal accessor requires one exact checker-selected project-interface property.",
          member.getter?.element ?? member.setter?.element ?? expression,
        );
        return undefined;
      }
      const declarations = Object.freeze([...member.sourceSelectedDeclarations]);
      for (const declaration of declarations) accessorAssignments.add(declaration);
      if (member.getter !== undefined) {
        const getterDeclarations = property.kind === "accessor-property"
          ? property.read === undefined ? undefined : Object.freeze([property.read.declaration])
          : Object.freeze([property.declaration]);
        if (getterDeclarations === undefined) {
          reject(
            input,
            "MOJO_OBJECT_GETTER_CONTRACT_UNRESOLVED",
            "Object-literal getter has no exact checker-selected readable project property contract.",
            member.getter.element,
          );
          return undefined;
        }
        accessors.set(member.getter.element, Object.freeze({
          kind: "getter",
          selectedType: member.getter.sourceElementType,
          contractDeclarations: getterDeclarations,
          name: property.kind === "accessor-property"
            ? property.read?.name ?? `_get_${member.sourceName}`
            : `_get_${member.sourceName}`,
        }));
      }
      if (member.setter !== undefined) {
        const setterDeclarations = property.kind === "accessor-property"
          ? property.write === undefined ? undefined : Object.freeze([property.write.declaration])
          : Object.freeze([property.declaration]);
        if (setterDeclarations === undefined) {
          reject(
            input,
            "MOJO_OBJECT_SETTER_CONTRACT_UNRESOLVED",
            "Object-literal setter has no exact checker-selected writable project property contract.",
            member.setter.element,
          );
          return undefined;
        }
        accessors.set(member.setter.element, Object.freeze({
          kind: "setter",
          selectedType: member.setter.sourceElementType,
          contractDeclarations: setterDeclarations,
          name: property.kind === "accessor-property"
            ? property.write?.name ?? `_set_${member.sourceName}`
            : `_set_${member.sourceName}`,
        }));
      }
    }
  }
  const contributions: MojoObjectLiteralContribution[] = [];
  const assigned = new Set<Node>(accessorAssignments);
  for (const element of ast.properties(expression)) {
    if (element === undefined) {
      reject(input, "MOJO_OBJECT_ELEMENT_EVIDENCE_INCOMPLETE", "Object literal contains an undefined source element.", expression);
      return undefined;
    }
    if (ast.is.IsSpreadAssignment(element)) {
      const value = SpreadAssignment_Expression(ast, element);
      const sourceType = value === undefined ? undefined : input.expressionTypes.get(value);
      if (value === undefined || sourceType === undefined || !mojoTargetTypeEquals(sourceType, constructionType)) {
        reject(input, "MOJO_OBJECT_SPREAD_CARRIER_UNPROVEN", "Object spread requires one exact value of the same sealed project-interface carrier.", element);
        return undefined;
      }
      contributions.push(Object.freeze({
        kind: "spread",
        element,
        value,
        sourceType,
        fields: Object.freeze(instantiatedFields),
        methods: instantiatedMethods,
        indexSignatures: instantiatedIndexSignatures,
      }));
      for (const field of instantiatedFields) assigned.add(field.field.declaration);
      continue;
    }
    if (ast.is.IsMethodDeclaration(element)) {
      const selected = semantics.operations.objectLiteralElement(element);
      const contracts = selected === undefined
        ? []
        : uniqueCallableContracts(
            [selected.sourceSelectedDeclaration, ...selected.sourceSelectedDeclarations],
            input.callableByDeclaration,
          );
      const contractDeclarations = Object.freeze(contracts.map((contract) =>
        contract.contract.declaration));
      const implementation = selected === undefined || selected.objectLiteral !== expression ||
          selected.element !== element || selected.elementKind !== "method" ||
          contracts.length === 0
        ? undefined
        : input.analyzeCallable(
            element,
            selected.sourceElementType,
            "method",
            contracts[0]!.contract.name,
            owner,
          );
      if (implementation === undefined) {
        reject(
          input,
          "MOJO_OBJECT_METHOD_SELECTION_UNRESOLVED",
          "Object-literal method requires exact checker-selected interface contracts and one closed implementation body.",
          element,
        );
        return undefined;
      }
      contributions.push(Object.freeze({
        kind: "method",
        element,
        contractDeclarations,
      }));
      continue;
    }
    if (ast.is.IsGetAccessorDeclaration(element) || ast.is.IsSetAccessorDeclaration(element)) {
      const accessor = accessors.get(element);
      const implementation = accessor === undefined
        ? undefined
        : input.analyzeCallable(
            element,
            accessor.selectedType,
            accessor.kind,
            accessor.name,
            owner,
          );
      if (accessor === undefined || implementation === undefined) {
        reject(
          input,
          "MOJO_OBJECT_ACCESSOR_IMPLEMENTATION_UNRESOLVED",
          "Object-literal accessor requires one exact checker-selected interface contract and closed implementation body.",
          element,
        );
        return undefined;
      }
      contributions.push(Object.freeze({
        kind: accessor.kind,
        element,
        contractDeclarations: accessor.contractDeclarations,
      }));
      continue;
    }
    if (!ast.is.IsPropertyAssignment(element) && !ast.is.IsShorthandPropertyAssignment(element)) {
      return undefined;
    }
    const selected = semantics.operations.objectLiteralElement(element);
    const value = ObjectLiteralProperty_Value(ast, element);
    const selectedCandidates = selected === undefined
      ? []
      : [selected.sourceSelectedDeclaration, ...selected.sourceSelectedDeclarations]
          .flatMap((declaration) => declaration === undefined
            ? []
            : [input.fieldByDeclaration.get(declaration)])
          .filter((candidate): candidate is MojoAnalyzedProjectProperty => candidate !== undefined);
    const selectedUnique = [...new Set(selectedCandidates)];
    const selectedField = selectedUnique.length === 1
      ? selectedUnique[0]
      : selectedUnique.length === 0 && instantiatedIndexSignatures.length === 1
        ? instantiatedIndexSignatures[0]!.indexSignature
        : undefined;
    const instantiated = selectedField?.kind === "interface-field"
      ? fieldTypes.get(selectedField.declaration)
      : undefined;
    const instantiatedAccessor = selectedField?.kind === "accessor-property"
      ? instantiateAccessorProperty(selectedField, constructionType, input.projectRelationships)
      : undefined;
    const instantiatedIndex = selectedField?.kind === "interface-index-signature"
      ? indexTypes.get(selectedField.declaration)
      : undefined;
    const expectedKind = ast.is.IsPropertyAssignment(element) ? "property" : "shorthand";
    if (selected === undefined || selected.objectLiteral !== expression || selected.element !== element ||
      selected.elementKind !== expectedKind || value === undefined ||
      (instantiated === undefined && instantiatedAccessor === undefined && instantiatedIndex === undefined)) {
      reject(input, "MOJO_OBJECT_FIELD_SELECTION_UNRESOLVED", "Object property requires one exact checker-selected project-interface field.", element);
      return undefined;
    }
    if (instantiatedIndex !== undefined) {
      const key = objectIndexKey(element, instantiatedIndex.keyType, source);
      if (key === undefined) {
        reject(input, "MOJO_OBJECT_INDEX_KEY_UNSUPPORTED", "Object index entry requires one exact literal or computed key compatible with its selected index signature.", element);
        return undefined;
      }
      contributions.push(Object.freeze({
        kind: "index-entry",
        element,
        value,
        key,
        indexSignature: instantiatedIndex.indexSignature,
        keyType: instantiatedIndex.keyType,
        valueType: instantiatedIndex.valueType,
      }));
      continue;
    }
    if (instantiated === undefined && instantiatedAccessor === undefined) {
      reject(input, "MOJO_OBJECT_FIELD_SELECTION_UNRESOLVED", "Object property has no exact instantiated project-interface field.", element);
      return undefined;
    }
    const fieldType = instantiated?.fieldType ?? instantiatedAccessor!.fieldType;
    if ((ast.is.IsFunctionExpression(value) || ast.is.IsArrowFunction(value)) &&
      fieldType.kind === "callable") {
      const callable = input.analyzeCallableValue(value, selected.sourceSelectedType);
      if (callable === undefined) {
        return undefined;
      }
      input.expressionTypes.set(value, callable.callableType);
    }
    contributions.push(Object.freeze({
      kind: "field",
      element,
      value,
      field: instantiated?.field ?? instantiatedAccessor!.property,
      fieldType,
    }));
    for (const declaration of instantiated === undefined
      ? instantiatedAccessor!.property.declarations
      : [instantiated.field.declaration]) assigned.add(declaration);
  }
  const missing = instantiatedFields.find(({ field }) => !field.optional && !assigned.has(field.declaration));
  if (missing !== undefined) {
    reject(input, "MOJO_OBJECT_REQUIRED_FIELD_MISSING", "Object literal omits a required checker-selected project-interface field.", expression);
    return undefined;
  }
  input.expressionTypes.set(expression, resultType);
  return Object.freeze({
    kind: "interface",
    interface: interface_,
    constructionType,
    construction,
    resultType,
    resultConversion: resultConversion.conversion,
    fields: instantiatedFields,
    indexSignatures: instantiatedIndexSignatures,
    contributions: Object.freeze(contributions),
  });
}
