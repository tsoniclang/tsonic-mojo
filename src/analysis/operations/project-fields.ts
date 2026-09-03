import type { AstReader, Node, ResolvedSourcePropertyAccessInfo, Type } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type {
  MojoAnalyzedInterfaceIndexSignature,
  MojoAnalyzedProjectCallable,
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
  callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>,
  receiverType: MojoTargetTypeRef | undefined,
  selectedSubjects: readonly object[],
  ast: AstReader,
  projectRelationships: MojoProjectTypeRelationships,
  resolveType: (type: Type) => MojoTargetTypeRef | undefined,
): MojoProjectFieldAnalysis {
  if (source.accessMode === "delete") {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_DELETE_UNSUPPORTED",
      reason: "Deleting a statically declared project field has no Mojo storage operation.",
    };
  }
  if (source.callCallee) return { kind: "not-project-field" };
  const selectedDeclarations = [
    source.selectedDeclaration,
    source.selectedReadDeclaration,
    source.selectedWriteDeclaration,
    ...selectedSubjects,
  ];
  const candidates = selectedDeclarations.map((declaration) => declaration === undefined
    ? undefined
    : fieldByDeclaration.get(declaration as Node))
    .filter((field): field is MojoAnalyzedProjectProperty => field !== undefined);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) {
    return analyzeProjectMethodProperty(
      source,
      selectedDeclarations,
      callableByDeclaration,
      receiverType,
      resolveType,
    );
  }
  if (unique.length !== 1) {
    return analyzeProjectUnionProperty(
      source,
      unique,
      receiverType,
      projectRelationships,
    );
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
    const instantiated = instantiateProjectIndexSignature(
      field,
      receiverType,
      projectRelationships,
    );
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
  if (field.kind === "accessor-property") {
    if (receiverType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_ACCESSOR_RECEIVER_NOT_CLOSED",
        reason: "Selected project accessor receiver has no exact non-null Mojo carrier.",
      };
    }
    const readType = field.read === undefined
      ? undefined
      : projectRelationships.instantiateMemberType(
          field.read.declaration,
          receiverType,
          field.read.resultType,
        );
    const writeParameter = field.write?.parameters[0];
    const writeType = writeParameter === undefined
      ? undefined
      : projectRelationships.instantiateMemberType(
          field.write!.declaration,
          receiverType,
          writeParameter.callType,
        );
    if ((source.accessMode === "read" || source.accessMode === "read-write") &&
        (field.read === undefined || readType === undefined) ||
      (source.accessMode === "write" || source.accessMode === "read-write") &&
        (field.write === undefined || writeParameter === undefined || writeType === undefined)) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_ACCESSOR_MODE_UNAVAILABLE",
        reason: `Selected project accessor '${field.sourceName}' does not close its exact ${source.accessMode} contract.`,
      };
    }
    return {
      kind: "resolved",
      expressionType: optionalAccessResult(readType ?? writeType!, source.optionalChain),
      selection: Object.freeze({
        kind: "project-accessor",
        declarations: field.declarations,
        receiver: source.receiver.expression,
        receiverType,
        ...(field.read === undefined ? {} : { readName: field.read.name }),
        ...(readType === undefined ? {} : { readType }),
        ...(field.write === undefined ? {} : { writeName: field.write.name }),
        ...(writeType === undefined ? {} : { writeType }),
        ...(writeParameter === undefined ? {} : { writeDisposition: writeParameter.disposition }),
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
  const fieldType = instantiateProjectFieldType(field, receiverType, projectRelationships);
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
      declaration: field.declaration,
      receiver: source.receiver.expression,
      fieldName: field.name,
      fieldType,
      receiverType,
      accessMode: source.accessMode,
      optionalChain: source.optionalChain,
    }),
  };
}

function analyzeProjectMethodProperty(
  source: ResolvedSourcePropertyAccessInfo,
  selectedDeclarations: readonly (object | undefined)[],
  callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>,
  receiverType: MojoTargetTypeRef | undefined,
  resolveType: (type: Type) => MojoTargetTypeRef | undefined,
): MojoProjectFieldAnalysis {
  if (source.accessMode === "delete") {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_DELETE_UNSUPPORTED",
      reason: "Deleting a statically selected project method has no closed Mojo operation.",
    };
  }
  const candidates = [...new Set(selectedDeclarations.flatMap((declaration) => {
    const callable = declaration === undefined
      ? undefined
      : callableByDeclaration.get(declaration as Node);
    return callable === undefined ? [] : [callable];
  }))];
  if (candidates.length === 0) return { kind: "not-project-field" };
  if (candidates.length !== 1) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_PROPERTY_IDENTITY_CONFLICT",
      reason: "A project method value requires one exact checker-selected callable declaration.",
    };
  }
  const callable = candidates[0]!;
  if (callable.contract.kind !== "method") {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_NON_METHOD_CALLABLE_PROPERTY_UNSUPPORTED",
      reason: "Only an exact project instance method can be selected as a property value.",
    };
  }
  if (callable.contract.static === true) {
    return {
      kind: "unsupported",
      code: "MOJO_STATIC_METHOD_PROPERTY_UNSUPPORTED",
      reason: "A static project method value requires a distinct sealed static-callable representation.",
    };
  }
  if (callable.contract.typeParameters.length !== 0) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_CALLABLE_NOT_CLOSED",
      reason: "A generic project method value has no exact closed callable specialization.",
    };
  }
  if (receiverType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_RECEIVER_NOT_CLOSED",
      reason: "A project method value has no exact non-null Mojo receiver carrier.",
    };
  }
  if (source.optionalChain && source.accessMode !== "read") {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_OPTIONAL_METHOD_WRITE_UNSUPPORTED",
      reason: "An optional project method access cannot be selected as a writable location.",
    };
  }
  const readType = source.sourceReadType === undefined
    ? undefined
    : resolveType(source.sourceReadType);
  const writeType = source.sourceWriteType === undefined
    ? undefined
    : resolveType(source.sourceWriteType);
  if ((source.accessMode === "read" || source.accessMode === "read-write") &&
      readType?.kind !== "callable" ||
    (source.accessMode === "write" || source.accessMode === "read-write") &&
      writeType?.kind !== "callable") {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_CALLABLE_NOT_CLOSED",
      reason: "A project method property requires one exact closed callable read/write carrier.",
    };
  }
  if (readType !== undefined && writeType !== undefined &&
    !mojoTargetTypeEquals(readType, writeType)) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_CALLABLE_ABI_CONFLICT",
      reason: "A project method property's exact read and write callable carriers disagree.",
    };
  }
  const callableType = readType?.kind === "callable"
    ? readType
    : writeType?.kind === "callable"
      ? writeType
      : undefined;
  if (callableType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_CALLABLE_NOT_CLOSED",
      reason: "A project method property has no exact closed callable carrier.",
    };
  }
  return {
    kind: "resolved",
    expressionType: optionalAccessResult(callableType, source.optionalChain),
    selection: Object.freeze({
      kind: "project-method",
      declaration: callable.contract.declaration,
      receiver: source.receiver.expression,
      receiverType,
      callableType,
      accessMode: source.accessMode,
      optionalChain: source.optionalChain,
    }),
  };
}

export function instantiateProjectIndexSignature(
  indexSignature: MojoAnalyzedInterfaceIndexSignature,
  receiverType: MojoTargetTypeRef,
  projectRelationships: MojoProjectTypeRelationships,
): { readonly keyType: MojoTargetTypeRef; readonly valueType: MojoTargetTypeRef } | undefined {
  const owner = projectRelationships.definitionContainingDeclaration(indexSignature.declaration);
  const relationship = owner === undefined
    ? undefined
    : projectRelationships.relationship(receiverType, owner);
  if (relationship?.kind !== "related" || relationship.targetType.kind !== "target-named") {
    return undefined;
  }
  const arguments_ = relationship.targetType.genericArguments ?? [];
  const substitutions = projectOwnerSubstitutions(indexSignature.ownerTypeParameters, arguments_);
  if (substitutions === undefined) return undefined;
  return Object.freeze({
    keyType: substituteMojoTargetType(indexSignature.keyType, substitutions),
    valueType: substituteMojoTargetType(indexSignature.valueType, substitutions),
  });
}

function analyzeProjectUnionProperty(
  source: ResolvedSourcePropertyAccessInfo,
  candidates: readonly MojoAnalyzedProjectProperty[],
  receiverType: MojoTargetTypeRef | undefined,
  projectRelationships: MojoProjectTypeRelationships,
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
    const matching = candidates.flatMap((candidate) => {
      if (candidate.kind !== "instance-field" && candidate.kind !== "interface-field") return [];
      const fieldType = instantiateProjectFieldType(candidate, member, projectRelationships);
      return fieldType === undefined ? [] : [{ field: candidate, fieldType }];
    });
    if (matching.length !== 1) return undefined;
    const field = matching[0]!.field as Extract<MojoAnalyzedProjectProperty, {
      readonly kind: "instance-field" | "interface-field";
    }>;
    return Object.freeze({
      receiverType: member,
      fieldName: field.name,
      fieldType: matching[0]!.fieldType,
    });
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
  projectRelationships: MojoProjectTypeRelationships,
): MojoTargetTypeRef | undefined {
  const owner = projectRelationships.definitionContainingDeclaration(field.declaration);
  const relationship = owner === undefined
    ? undefined
    : projectRelationships.relationship(receiverType, owner);
  if (relationship?.kind !== "related" || relationship.targetType.kind !== "target-named") {
    return undefined;
  }
  const arguments_ = relationship.targetType.genericArguments ?? [];
  const substitutions = projectOwnerSubstitutions(field.ownerTypeParameters, arguments_);
  return substitutions === undefined
    ? undefined
    : substituteMojoTargetType(field.type, substitutions);
}

function projectOwnerSubstitutions(
  parameters: readonly import("../../target-model/types/project.js").MojoProjectTypeParameterDefinition[],
  arguments_: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[],
): import("../../target-model/types/substitution.js").MojoTargetTypeSubstitutions | undefined {
  if (parameters.length !== arguments_.length) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, import("../../target-model/types/model.js").MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index];
    if (parameter.kind === "type" && argument?.kind === "type") {
      types.set(parameter.name, argument.type);
    } else if (parameter.kind === "origin" && argument?.kind === "origin") {
      origins.set(parameter.name, argument.origin);
    } else if (parameter.kind === "value" && argument !== undefined && isValueGenericArgument(argument)) {
      values.set(parameter.name, argument);
    } else {
      return undefined;
    }
  }
  return Object.freeze({
    types,
    values,
    origins,
    packs: new Map<string, readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[]>(),
  });
}

function isValueGenericArgument(
  argument: import("../../target-model/types/model.js").MojoTargetGenericArgument,
): boolean {
  return argument.kind !== "type" && argument.kind !== "origin" && argument.kind !== "unbound";
}
