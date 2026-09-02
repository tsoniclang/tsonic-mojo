import type { AstReader, Node, ResolvedSourcePropertyAccessInfo } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type {
  MojoAnalyzedInterfaceIndexSignature,
  MojoAnalyzedProjectProperty,
  MojoPropertySelection,
} from "../program/model.js";

export type MojoProjectFieldAnalysis =
  | {
      readonly kind: "resolved";
      readonly selection: MojoPropertySelection;
      readonly expressionType: MojoTargetTypeRef;
    }
  | { readonly kind: "not-project-field" }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoProjectProperty(
  source: ResolvedSourcePropertyAccessInfo,
  fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>,
  receiverType: MojoTargetTypeRef | undefined,
  selectedSubjects: readonly object[],
  ast: AstReader,
): MojoProjectFieldAnalysis {
  if (source.accessMode === "delete") {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_DELETE_UNSUPPORTED",
      reason: "Deleting a statically declared project field has no Mojo storage operation.",
    };
  }
  const candidates = [
    source.selectedDeclaration,
    source.selectedReadDeclaration,
    source.selectedWriteDeclaration,
    ...selectedSubjects,
  ].map((declaration) => declaration === undefined
    ? undefined
    : fieldByDeclaration.get(declaration as Node))
    .filter((field): field is MojoAnalyzedProjectProperty => field !== undefined);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return { kind: "not-project-field" };
  if (unique.length !== 1) {
    return analyzeProjectUnionProperty(source, unique, receiverType);
  }
  const field = unique[0]!;
  if (field.kind === "enum-member") {
    return {
      kind: "resolved",
      expressionType: field.owner,
      selection: Object.freeze({
        kind: "project-enum-member",
        owner: field.owner,
        name: field.name,
        resultType: field.owner,
      }),
    };
  }
  if (field.kind === "static-field") {
    return {
      kind: "resolved",
      expressionType: field.type,
      selection: Object.freeze({
        kind: "project-static-field",
        binding: field.binding,
        fieldName: field.name,
        fieldType: field.type,
        accessMode: source.accessMode,
        optionalChain: source.optionalChain,
      }),
    };
  }
  if (field.kind === "interface-index-signature") {
    if (receiverType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_INDEX_PROPERTY_RECEIVER_NOT_CLOSED",
        reason: "Selected project index-property receiver has no exact non-null Mojo carrier.",
      };
    }
    const instantiated = instantiateProjectIndexSignature(field, receiverType);
    const propertyName = ast.name(source.expression);
    const key = propertyName === undefined ? "" : ast.text(propertyName);
    if (instantiated === undefined || key === "") {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_INDEX_PROPERTY_INSTANTIATION_UNRESOLVED",
        reason: "Selected project index property does not exactly instantiate its receiver and authored key.",
      };
    }
    if (field.readonly && source.accessMode !== "read") {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_INDEX_READONLY_WRITE",
        reason: "A readonly project index signature cannot be selected for a write.",
      };
    }
    return {
      kind: "resolved",
      expressionType: optionalAccessResult(instantiated.valueType, source.optionalChain),
      selection: Object.freeze({
        kind: "project-index-property",
        receiver: source.receiver.expression,
        receiverType,
        storageName: field.storageName,
        key,
        keyType: instantiated.keyType,
        fieldType: instantiated.valueType,
        accessMode: source.accessMode,
        optionalChain: source.optionalChain,
      }),
    };
  }
  if (receiverType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_RECEIVER_NOT_CLOSED",
      reason: "Selected project-property receiver has no exact non-null Mojo carrier.",
    };
  }
  const fieldType = instantiateProjectFieldType(field, receiverType);
  if (fieldType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_INSTANTIATION_UNRESOLVED",
      reason: "Selected project-property receiver does not exactly instantiate its declaring owner.",
    };
  }
  return {
    kind: "resolved",
    expressionType: optionalAccessResult(fieldType, source.optionalChain),
    selection: Object.freeze({
      kind: "project-field",
      receiver: source.receiver.expression,
      fieldName: field.name,
      fieldType,
      receiverType,
      accessMode: source.accessMode,
      optionalChain: source.optionalChain,
    }),
  };
}

export function instantiateProjectIndexSignature(
  indexSignature: MojoAnalyzedInterfaceIndexSignature,
  receiverType: MojoTargetTypeRef,
): { readonly keyType: MojoTargetTypeRef; readonly valueType: MojoTargetTypeRef } | undefined {
  if (indexSignature.ownerType.kind !== "target-named" || receiverType.kind !== "target-named" ||
    indexSignature.ownerType.id !== receiverType.id) return undefined;
  const arguments_ = receiverType.genericArguments ?? [];
  if (arguments_.length !== indexSignature.ownerTypeParameters.length ||
    arguments_.some((argument) => argument.kind !== "type")) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  for (const [index, name] of indexSignature.ownerTypeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    types.set(name, argument.type);
  }
  const substitutions = { types, values: new Map<string, never>(), packs: new Map<string, never>() };
  return Object.freeze({
    keyType: substituteMojoTargetType(indexSignature.keyType, substitutions),
    valueType: substituteMojoTargetType(indexSignature.valueType, substitutions),
  });
}

function analyzeProjectUnionProperty(
  source: ResolvedSourcePropertyAccessInfo,
  candidates: readonly MojoAnalyzedProjectProperty[],
  receiverType: MojoTargetTypeRef | undefined,
): MojoProjectFieldAnalysis {
  if (receiverType?.kind !== "union" || source.accessMode !== "read" || source.optionalChain) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_IDENTITY_CONFLICT",
      reason: "Selected property declarations require one exact readable union-member projection.",
    };
  }
  const fields = receiverType.members.map((member) => {
    if (member.kind !== "target-named") return undefined;
    const matching = candidates.filter((candidate) =>
      (candidate.kind === "instance-field" || candidate.kind === "interface-field") &&
      candidate.ownerType.kind === "target-named" && candidate.ownerType.id === member.id);
    if (matching.length !== 1) return undefined;
    const field = matching[0] as Extract<MojoAnalyzedProjectProperty, {
      readonly kind: "instance-field" | "interface-field";
    }>;
    const fieldType = instantiateProjectFieldType(field, member);
    return fieldType === undefined
      ? undefined
      : Object.freeze({ receiverType: member, fieldName: field.name, fieldType });
  });
  if (fields.some((field) => field === undefined)) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_UNION_PROPERTY_INCOMPLETE",
      reason: "A selected union property is not defined exactly once on every closed union member.",
    };
  }
  const exactFields = fields as readonly NonNullable<(typeof fields)[number]>[];
  const resultType = exactFields[0]?.fieldType;
  if (resultType === undefined ||
    exactFields.some((field) => !mojoTargetTypeEquals(field.fieldType, resultType))) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_UNION_PROPERTY_RESULT_UNCLOSED",
      reason: "A selected union property requires one identical Mojo result carrier on every member.",
    };
  }
  return {
    kind: "resolved",
    expressionType: resultType,
    selection: Object.freeze({
      kind: "project-union-field",
      receiver: source.receiver.expression,
      receiverType,
      fields: Object.freeze(exactFields),
      resultType,
      accessMode: "read",
    }),
  };
}

function optionalAccessResult(
  type: MojoTargetTypeRef,
  optionalChain: boolean,
): MojoTargetTypeRef {
  return !optionalChain || type.kind === "optional"
    ? type
    : Object.freeze({ kind: "optional", value: type });
}

export function instantiateProjectFieldType(
  field: Extract<MojoAnalyzedProjectProperty, {
    readonly kind: "instance-field" | "interface-field";
  }>,
  receiverType: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  if (field.ownerType.kind !== "target-named" || receiverType.kind !== "target-named" ||
    field.ownerType.id !== receiverType.id) return undefined;
  const arguments_ = receiverType.genericArguments ?? [];
  if (arguments_.length !== field.ownerTypeParameters.length ||
    arguments_.some((argument) => argument.kind !== "type")) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  for (const [index, name] of field.ownerTypeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    types.set(name, argument.type);
  }
  return substituteMojoTargetType(field.type, { types, values: new Map(), packs: new Map() });
}
