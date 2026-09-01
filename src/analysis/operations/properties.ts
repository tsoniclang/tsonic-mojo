import type { Node, ResolvedSourcePropertyAccessInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { classifyMojoValueConversion } from "../conversions/classification.js";
import type { MojoConversionIndex } from "../conversions/classification.js";
import type { MojoAnalyzedProjectProperty, MojoPropertySelection } from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { mojoTargetTypeEquals } from "../../target-model/provider/equality.js";
import { providerOwnerMatches } from "../types/resolution.js";
import {
  instantiateMojoProviderConstantOperation,
  instantiateMojoProviderPropertyOperation,
} from "./provider-instantiation.js";
import { selectedProviderDeclarationIdentity } from "./provider-selection.js";

export type MojoPropertyAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoPropertySelection; readonly expressionType: MojoTargetTypeRef }
  | { readonly kind: "not-project-field" }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoProjectProperty(
  source: ResolvedSourcePropertyAccessInfo,
  fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>,
  receiverType: MojoTargetTypeRef | undefined,
): MojoPropertyAnalysis {
  if (source.callCallee) return { kind: "not-project-field" };
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
  ].map((declaration) => declaration === undefined
    ? undefined
    : fieldByDeclaration.get(declaration))
    .filter((field): field is MojoAnalyzedProjectProperty => field !== undefined);
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return { kind: "not-project-field" };
  if (unique.length !== 1) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_IDENTITY_CONFLICT",
      reason: "Selected property read and write declarations resolve to different project fields.",
    };
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
  if (receiverType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_PROPERTY_RECEIVER_NOT_CLOSED",
      reason: "Selected project-property receiver has no exact non-null Mojo carrier.",
    };
  }
  return {
    kind: "resolved",
    expressionType: field.type,
    selection: Object.freeze({
      kind: "project-field",
      receiver: source.receiver.expression,
      fieldName: field.name,
      fieldType: field.type,
      receiverType,
      accessMode: source.accessMode,
      optionalChain: source.optionalChain,
    }),
  };
}

export interface MojoProviderPropertyAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly conversions: MojoConversionIndex;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
}

export function analyzeMojoProviderProperty(
  source: ResolvedSourcePropertyAccessInfo,
  context: MojoProviderPropertyAnalysisContext,
): MojoPropertyAnalysis {
  if (source.callCallee) return { kind: "not-project-field" };
  if (source.accessMode === "delete") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_DELETE_UNSUPPORTED",
      reason: "Selected provider property has no delete operation contract.",
    };
  }
  const selectedIdentity = selectedProviderDeclarationIdentity(context.source, [
    source.selectedDeclaration,
    source.selectedSymbol,
    source.sourceDeclaration,
    source.sourceSymbol,
  ]);
  if (selectedIdentity?.exportId !== undefined && selectedIdentity.memberId === undefined) {
    if (source.accessMode !== "read" || source.sourceReadType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_CONSTANT_WRITE_UNSUPPORTED",
        reason: "A provider module constant can only be selected as a read.",
      };
    }
    const rows = context.providerSemantics.operations.filter((row) =>
      providerOwnerMatches(row, selectedIdentity) && row.exportId === selectedIdentity.exportId &&
      row.memberId === undefined && row.signatureId === undefined && row.operationKind === "property" &&
      row.target.kind === "constant");
    if (rows.length !== 1) {
      return {
        kind: "unsupported",
        code: rows.length === 0 ? "MOJO_PROVIDER_CONSTANT_OPERATION_MISSING" : "MOJO_PROVIDER_CONSTANT_OPERATION_AMBIGUOUS",
        reason: `Selected provider module constant has ${rows.length} exact Mojo operation rows.`,
      };
    }
    const instantiated = instantiateMojoProviderConstantOperation(rows[0]!);
    if (instantiated.kind === "unsupported") {
      return { kind: "unsupported", code: "MOJO_PROVIDER_CONSTANT_NOT_CLOSED", reason: instantiated.reason };
    }
    const selectedRead = context.resolveType(source.sourceReadType);
    if (selectedRead === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_CONSTANT_READ_TYPE_NOT_CLOSED",
        reason: "Selected provider module constant has no exact source carrier.",
      };
    }
    const conversion = context.conversions.record(source.expression, instantiated.operation.resultType, selectedRead);
    return conversion.kind === "unsupported"
      ? { kind: "unsupported", code: "MOJO_PROVIDER_CONSTANT_CONVERSION_UNPROVEN", reason: conversion.reason }
      : {
          kind: "resolved",
          expressionType: selectedRead,
          selection: Object.freeze({
            kind: "provider-constant",
            operation: instantiated.operation,
            readResultConversion: conversion.conversion,
          }),
        };
  }
  const receiverType = context.resolveType(source.receiver.type);
  if (receiverType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_RECEIVER_NOT_CLOSED",
      reason: "Selected provider property receiver has no exact Mojo carrier.",
    };
  }
  const read = source.accessMode === "read" || source.accessMode === "read-write"
    ? selectOperation("property", source.selectedReadDeclaration ?? source.selectedDeclaration, source, context, receiverType)
    : undefined;
  const write = source.accessMode === "write" || source.accessMode === "read-write"
    ? selectOperation("property-set", source.selectedWriteDeclaration ?? source.selectedDeclaration, source, context, receiverType)
    : undefined;
  if (read?.kind === "unsupported") return read;
  if (write?.kind === "unsupported") return write;
  if (read === undefined && write === undefined) return { kind: "not-project-field" };
  const receiverTarget = read?.operation.receiverType ?? write?.operation.receiverType;
  if (receiverTarget === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_RECEIVER_ABI_MISSING",
      reason: "Selected provider property has no closed receiver ABI.",
    };
  }
  if (read?.operation.receiverType !== undefined && write?.operation.receiverType !== undefined &&
    !mojoTargetTypeEquals(read.operation.receiverType, write.operation.receiverType)) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_RECEIVER_ABI_CONFLICT",
      reason: "Selected provider property read and write require different receiver carriers.",
    };
  }
  const receiverConversion = classifyMojoValueConversion(receiverType, receiverTarget);
  if (receiverConversion.kind === "unsupported") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_RECEIVER_CONVERSION_UNPROVEN",
      reason: receiverConversion.reason,
    };
  }
  let expressionType: MojoTargetTypeRef;
  let readResultConversion;
  if (read !== undefined) {
    const selectedRead = source.sourceReadType === undefined
      ? undefined
      : context.resolveType(source.sourceReadType);
    if (selectedRead === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_PROPERTY_READ_TYPE_NOT_CLOSED",
        reason: "Selected provider property read has no exact source carrier.",
      };
    }
    const conversion = context.conversions.record(source.expression, read.operation.resultType, selectedRead);
    if (conversion.kind === "unsupported") {
      return { kind: "unsupported", code: "MOJO_PROVIDER_PROPERTY_READ_CONVERSION_UNPROVEN", reason: conversion.reason };
    }
    expressionType = selectedRead;
    readResultConversion = conversion.conversion;
  } else {
    const selectedWrite = source.sourceWriteType === undefined
      ? undefined
      : context.resolveType(source.sourceWriteType);
    if (selectedWrite === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_PROPERTY_WRITE_TYPE_NOT_CLOSED",
        reason: "Selected provider property write has no exact source carrier.",
      };
    }
    expressionType = selectedWrite;
  }
  return {
    kind: "resolved",
    expressionType,
    selection: Object.freeze({
      kind: "provider",
      ...(read === undefined ? {} : { readOperation: read.operation }),
      ...(write === undefined ? {} : { writeOperation: write.operation }),
      receiver: source.receiver.expression,
      sourceReceiverType: receiverType,
      receiverConversion: receiverConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      optionalChain: source.optionalChain,
    }),
  };
}

function selectOperation(
  operationKind: "property" | "property-set",
  declaration: Node | undefined,
  source: ResolvedSourcePropertyAccessInfo,
  context: MojoProviderPropertyAnalysisContext,
  receiverType: MojoTargetTypeRef,
): { readonly kind: "resolved"; readonly operation: import("../program/model.js").MojoSelectedProviderOperation } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } | undefined {
  const identity = selectedProviderDeclarationIdentity(context.source, [
    declaration,
    source.selectedSymbol,
    source.sourceDeclaration,
    source.sourceSymbol,
  ]);
  if (identity === undefined || identity.exportId === undefined || identity.memberId === undefined) return undefined;
  const rows = context.providerSemantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.memberId === identity.memberId && row.operationKind === operationKind);
  if (rows.length !== 1) {
    return {
      kind: "unsupported",
      code: rows.length === 0 ? "MOJO_PROVIDER_PROPERTY_OPERATION_MISSING" : "MOJO_PROVIDER_PROPERTY_OPERATION_AMBIGUOUS",
      reason: `Selected provider ${operationKind} has ${rows.length} exact Mojo operation rows.`,
    };
  }
  const instantiated = instantiateMojoProviderPropertyOperation(rows[0]!, receiverType);
  return instantiated.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_PROVIDER_PROPERTY_NOT_CLOSED", reason: instantiated.reason }
    : { kind: "resolved", operation: instantiated.operation };
}
