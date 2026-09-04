import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedInterfaceIndexSignature,
  MojoAnalyzedProjectCallable,
  MojoAnalyzedProjectProperty,
  MojoObjectLiteralContribution,
} from "../program/model.js";
import type { MojoObjectLiteralAnalysisInput } from "./object-literals.js";

export function uniqueCallableContracts(
  declarations: readonly (Node | undefined)[],
  index: WeakMap<Node, MojoAnalyzedProjectCallable>,
): readonly MojoAnalyzedProjectCallable[] {
  return [...new Set(declarations.flatMap((declaration) => {
    const callable = declaration === undefined ? undefined : index.get(declaration);
    return callable === undefined ? [] : [callable];
  }))];
}

export function uniqueAccessorProperties(
  declarations: readonly Node[],
  index: WeakMap<Node, MojoAnalyzedProjectProperty>,
): readonly Extract<MojoAnalyzedProjectProperty, {
  readonly kind: "accessor-property" | "interface-field";
}>[] {
  return [...new Set(declarations.flatMap((declaration) => {
    const property = index.get(declaration);
    return property?.kind === "accessor-property" || property?.kind === "interface-field"
      ? [property]
      : [];
  }))];
}

export function instantiateAccessorProperty(
  property: Extract<MojoAnalyzedProjectProperty, { readonly kind: "accessor-property" }>,
  receiverType: MojoTargetTypeRef,
  relationships: MojoProjectTypeRelationships,
): { readonly property: typeof property; readonly fieldType: MojoTargetTypeRef } | undefined {
  const readType = property.read === undefined
    ? undefined
    : relationships.instantiateMemberType(
        property.read.declaration,
        receiverType,
        property.read.resultType,
      );
  const writeParameter = property.write?.parameters[0];
  const writeType = writeParameter === undefined
    ? undefined
    : relationships.instantiateMemberType(
        property.write!.declaration,
        receiverType,
        writeParameter.callType,
      );
  const fieldType = readType ?? writeType;
  if (fieldType === undefined ||
    (readType !== undefined && writeType !== undefined &&
      !mojoTargetTypeEquals(readType, writeType))) return undefined;
  return Object.freeze({ property, fieldType });
}

export function selectConstructionType(
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
  const types = typeSubstitutions(interface_, arguments_);
  if (types === undefined) return undefined;
  const substitutions = {
    types,
    values: new Map<string, never>(),
    origins: new Map<string, never>(),
    packs: new Map<string, never>(),
  };
  return Object.freeze(interface_.indexSignatures.map((indexSignature) => Object.freeze({
    indexSignature,
    keyType: substituteMojoTargetType(indexSignature.keyType, substitutions),
    valueType: substituteMojoTargetType(indexSignature.valueType, substitutions),
  })));
}

export function objectIndexKey(
  element: Node,
  keyType: MojoTargetTypeRef,
  source: TargetSourceProgram,
): Extract<MojoObjectLiteralContribution, { readonly kind: "index-entry" }>["key"] | undefined {
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

function uniqueTargetTypes(types: readonly MojoTargetTypeRef[]): readonly MojoTargetTypeRef[] {
  const unique: MojoTargetTypeRef[] = [];
  for (const type of types) {
    if (!unique.some((candidate) => mojoTargetTypeEquals(candidate, type))) unique.push(type);
  }
  return unique;
}

function typeSubstitutions(
  interface_: MojoAnalyzedInterface,
  arguments_: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[],
): ReadonlyMap<string, MojoTargetTypeRef> | undefined {
  const types = new Map<string, MojoTargetTypeRef>();
  for (const [index, parameter] of interface_.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    types.set(parameter.name, argument.type);
    types.set(parameter.identity, argument.type);
  }
  return types;
}

function instantiateFields(
  interface_: MojoAnalyzedInterface,
  targetType: MojoTargetTypeRef,
): readonly { readonly field: MojoAnalyzedInterfaceField; readonly fieldType: MojoTargetTypeRef }[] | undefined {
  if (targetType.kind !== "target-named" || interface_.targetType.kind !== "target-named" ||
    targetType.id !== interface_.targetType.id) return undefined;
  const arguments_ = targetType.genericArguments ?? [];
  if (arguments_.length !== interface_.typeParameters.length ||
    arguments_.some((argument) => argument.kind !== "type")) return undefined;
  const types = typeSubstitutions(interface_, arguments_);
  if (types === undefined) return undefined;
  return Object.freeze(interface_.fields.map((field) => Object.freeze({
    field,
    fieldType: substituteMojoTargetType(field.type, {
      types,
      values: new Map(),
      origins: new Map(),
      packs: new Map(),
    }),
  })));
}

export function instantiateInterfaceClosure(
  constructionType: MojoTargetTypeRef,
  input: MojoObjectLiteralAnalysisInput,
): {
  readonly fields: readonly { readonly field: MojoAnalyzedInterfaceField; readonly fieldType: MojoTargetTypeRef }[];
  readonly indexSignatures: readonly {
    readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
    readonly keyType: MojoTargetTypeRef;
    readonly valueType: MojoTargetTypeRef;
  }[];
  readonly methods: readonly { readonly method: import("../program/model.js").MojoAnalyzedCallableSignature }[];
} | undefined {
  const related = [...input.interfaceByTypeId.values()].flatMap((interface_) => {
    const relationship = input.projectRelationships.relationship(constructionType, interface_.definition);
    return relationship.kind === "related"
      ? [Object.freeze({ interface_, type: relationship.targetType })]
      : [];
  });
  const fields: { readonly field: MojoAnalyzedInterfaceField; readonly fieldType: MojoTargetTypeRef }[] = [];
  const indexSignatures: {
    readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
    readonly keyType: MojoTargetTypeRef;
    readonly valueType: MojoTargetTypeRef;
  }[] = [];
  const methods: { readonly method: import("../program/model.js").MojoAnalyzedCallableSignature }[] = [];
  for (const entry of related) {
    const instantiatedFields = instantiateFields(entry.interface_, entry.type);
    const instantiatedIndexes = instantiateIndexSignatures(entry.interface_, entry.type);
    if (instantiatedFields === undefined || instantiatedIndexes === undefined) return undefined;
    for (const field of instantiatedFields) {
      if (!fields.some((candidate) => candidate.field.declaration === field.field.declaration)) fields.push(field);
    }
    for (const indexSignature of instantiatedIndexes) {
      if (!indexSignatures.some((candidate) =>
        candidate.indexSignature.declaration === indexSignature.indexSignature.declaration)) {
        indexSignatures.push(indexSignature);
      }
    }
    for (const method of entry.interface_.methods) {
      if (!methods.some((candidate) => candidate.method.declaration === method.declaration)) {
        methods.push(Object.freeze({ method }));
      }
    }
  }
  return Object.freeze({
    fields: Object.freeze(fields),
    indexSignatures: Object.freeze(indexSignatures),
    methods: Object.freeze(methods),
  });
}

export function rejectObjectLiteral(
  input: MojoObjectLiteralAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
