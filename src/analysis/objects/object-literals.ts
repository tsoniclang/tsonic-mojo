import type { Node, SourceFile } from "@tsonic/tsts";
import {
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedInterfaceIndexSignature,
  MojoAnalyzedProjectProperty,
  MojoObjectLiteralContribution,
  MojoObjectLiteralSelection,
} from "../program/model.js";

export interface MojoObjectLiteralAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
  readonly expression: Node;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expectedType?: MojoTargetTypeRef;
  readonly interfaceByTypeId: ReadonlyMap<string, MojoAnalyzedInterface>;
  readonly fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
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
  const resultConversion = classifyMojoValueConversion(constructionType, resultType);
  if (resultConversion.kind === "unsupported") {
    reject(input, "MOJO_OBJECT_RESULT_CONVERSION_UNPROVEN", resultConversion.reason, expression);
    return undefined;
  }
  const instantiatedFields = instantiateFields(interface_, constructionType);
  if (instantiatedFields === undefined) {
    reject(input, "MOJO_OBJECT_INTERFACE_INSTANTIATION_UNRESOLVED", "Object literal interface arguments do not exactly instantiate its declared fields.", expression);
    return undefined;
  }
  const fieldTypes = new Map(instantiatedFields.map((field) => [field.field.declaration, field] as const));
  const instantiatedIndexSignatures = instantiateIndexSignatures(interface_, constructionType);
  if (instantiatedIndexSignatures === undefined) {
    reject(input, "MOJO_OBJECT_INDEX_INSTANTIATION_UNRESOLVED", "Object literal interface arguments do not exactly instantiate its declared index signatures.", expression);
    return undefined;
  }
  const indexTypes = new Map(instantiatedIndexSignatures.map((entry) => [entry.indexSignature.declaration, entry] as const));
  const contributions: MojoObjectLiteralContribution[] = [];
  const assigned = new Set<Node>();
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
        indexSignatures: instantiatedIndexSignatures,
      }));
      for (const field of instantiatedFields) assigned.add(field.field.declaration);
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
    const instantiatedIndex = selectedField?.kind === "interface-index-signature"
      ? indexTypes.get(selectedField.declaration)
      : undefined;
    const expectedKind = ast.is.IsPropertyAssignment(element) ? "property" : "shorthand";
    if (selected === undefined || selected.objectLiteral !== expression || selected.element !== element ||
      selected.elementKind !== expectedKind || value === undefined ||
      (instantiated === undefined && instantiatedIndex === undefined)) {
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
    if (instantiated === undefined) {
      reject(input, "MOJO_OBJECT_FIELD_SELECTION_UNRESOLVED", "Object property has no exact instantiated project-interface field.", element);
      return undefined;
    }
    contributions.push(Object.freeze({
      kind: "field",
      element,
      value,
      field: instantiated.field,
      fieldType: instantiated.fieldType,
    }));
    assigned.add(instantiated.field.declaration);
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
    resultType,
    resultConversion: resultConversion.conversion,
    fields: instantiatedFields,
    indexSignatures: instantiatedIndexSignatures,
    contributions: Object.freeze(contributions),
  });
}

function selectConstructionType(
  resultType: MojoTargetTypeRef | undefined,
  contextualType: MojoTargetTypeRef | undefined,
  inferredType: MojoTargetTypeRef | undefined,
  expression: Node,
  input: MojoObjectLiteralAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const interfaceMembers = resultType === undefined
    ? []
    : projectInterfaceMembers(resultType, input.interfaceByTypeId);
  if (interfaceMembers.length === 0) return undefined;
  const semanticCandidates = [contextualType, inferredType].filter((candidate): candidate is MojoTargetTypeRef =>
    candidate !== undefined && interfaceMembers.some((member) => mojoTargetTypeEquals(member, candidate)));
  const exactSemanticCandidates = uniqueTargetTypes(semanticCandidates);
  if (exactSemanticCandidates.length === 1) return exactSemanticCandidates[0];

  const ownerIds = new Set<string>();
  for (const element of input.source.ast.properties(expression)) {
    if (element === undefined || input.source.ast.is.IsSpreadAssignment(element)) continue;
    if (!input.source.ast.is.IsPropertyAssignment(element) &&
      !input.source.ast.is.IsShorthandPropertyAssignment(element)) return undefined;
    const selected = semantics.operations.objectLiteralElement(element);
    const field = selected?.sourceSelectedDeclaration === undefined
      ? undefined
      : input.fieldByDeclaration.get(selected.sourceSelectedDeclaration);
    if ((field?.kind !== "interface-field" && field?.kind !== "interface-index-signature") ||
      field.ownerType.kind !== "target-named") return undefined;
    ownerIds.add(field.ownerType.id);
  }
  if (ownerIds.size !== 1) return undefined;
  const ownerId = [...ownerIds][0]!;
  const matches = interfaceMembers.filter((member) => member.id === ownerId);
  return matches.length === 1 ? matches[0] : undefined;
}

function projectInterfaceMembers(
  type: MojoTargetTypeRef,
  interfaces: ReadonlyMap<string, MojoAnalyzedInterface>,
): readonly Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>[] {
  if (type.kind === "target-named") return interfaces.has(type.id) ? Object.freeze([type]) : Object.freeze([]);
  if (type.kind === "optional") return projectInterfaceMembers(type.value, interfaces);
  if (type.kind !== "union") return Object.freeze([]);
  return Object.freeze(type.members.flatMap((member) => projectInterfaceMembers(member, interfaces)));
}

function instantiateIndexSignatures(
  interface_: MojoAnalyzedInterface,
  targetType: MojoTargetTypeRef,
): readonly {
  readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
  readonly keyType: MojoTargetTypeRef;
  readonly valueType: MojoTargetTypeRef;
}[] | undefined {
  if (targetType.kind !== "target-named" || interface_.targetType.kind !== "target-named" ||
    targetType.id !== interface_.targetType.id) return undefined;
  const arguments_ = targetType.genericArguments ?? [];
  if (arguments_.length !== interface_.typeParameters.length ||
    arguments_.some((argument) => argument.kind !== "type")) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  for (const [index, parameter] of interface_.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    types.set(parameter.name, argument.type);
  }
  const substitutions = { types, values: new Map<string, never>(), packs: new Map<string, never>() };
  return Object.freeze(interface_.indexSignatures.map((indexSignature) => Object.freeze({
    indexSignature,
    keyType: substituteMojoTargetType(indexSignature.keyType, substitutions),
    valueType: substituteMojoTargetType(indexSignature.valueType, substitutions),
  })));
}

function objectIndexKey(
  element: Node,
  keyType: MojoTargetTypeRef,
  source: TargetSourceProgram,
): Extract<MojoObjectLiteralContribution, { readonly kind: "index-entry" }>[
  "key"
] | undefined {
  const name = source.ast.name(element);
  if (name === undefined) return undefined;
  if (source.ast.is.IsComputedPropertyName(name)) {
    const expression = source.ast.as.AsComputedPropertyName(name)?.Expression;
    return expression === undefined ? undefined : Object.freeze({ kind: "expression", expression });
  }
  if (source.ast.is.IsNumericLiteral(name)) {
    return keyType.kind === "source-primitive" && keyType.name !== "bool" && keyType.name !== "char"
      ? Object.freeze({ kind: "literal", value: source.ast.text(name), literalKind: "number" })
      : undefined;
  }
  if (source.ast.is.IsIdentifier(name) || source.ast.is.IsStringLiteral(name) ||
    source.ast.is.IsNoSubstitutionTemplateLiteral(name)) {
    return keyType.kind === "native-string" ||
        keyType.kind === "target-named" && keyType.id === "tsonic.mojo.js.JsString"
      ? Object.freeze({ kind: "literal", value: source.ast.text(name), literalKind: "string" })
      : undefined;
  }
  return undefined;
}

function uniqueTargetTypes(
  types: readonly MojoTargetTypeRef[],
): readonly MojoTargetTypeRef[] {
  const unique: MojoTargetTypeRef[] = [];
  for (const type of types) {
    if (!unique.some((candidate) => mojoTargetTypeEquals(candidate, type))) unique.push(type);
  }
  return unique;
}

function instantiateFields(
  interface_: MojoAnalyzedInterface,
  targetType: MojoTargetTypeRef,
): readonly { readonly field: MojoAnalyzedInterfaceField; readonly fieldType: MojoTargetTypeRef }[] | undefined {
  if (targetType.kind !== "target-named" || interface_.targetType.kind !== "target-named" ||
    targetType.id !== interface_.targetType.id) return undefined;
  const arguments_ = targetType.genericArguments ?? [];
  if (arguments_.length !== interface_.typeParameters.length || arguments_.some((argument) => argument.kind !== "type")) {
    return undefined;
  }
  const types = new Map<string, MojoTargetTypeRef>();
  for (const [index, parameter] of interface_.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    types.set(parameter.name, argument.type);
  }
  return Object.freeze(interface_.fields.map((field) => Object.freeze({
    field,
    fieldType: substituteMojoTargetType(field.type, { types, values: new Map(), packs: new Map() }),
  })));
}

function reject(
  input: MojoObjectLiteralAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
