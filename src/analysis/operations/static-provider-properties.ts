import type { ResolvedSourcePropertyAccessInfo } from "@tsonic/tsts";
import { instantiateMojoProviderConstantOperation } from "../../policy/operations/provider-instantiation.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoPropertyAnalysis,
  MojoProviderPropertyAnalysisContext,
} from "./properties.js";
import {
  classifyMojoSourceResultConversion,
  mojoConvertedValueType,
} from "./call-results.js";

export function analyzeStaticProviderProperty(
  source: ResolvedSourcePropertyAccessInfo,
  identity: NonNullable<ReturnType<typeof selectedProviderDeclarationIdentity>>,
  context: MojoProviderPropertyAnalysisContext,
): MojoPropertyAnalysis | undefined {
  const readRows = context.providerSemantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.memberId === identity.memberId && row.signatureId === undefined &&
    row.operationKind === "property" && row.target.kind === "function-read" &&
    row.receiverType === undefined);
  const writeRows = context.providerSemantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.memberId === identity.memberId && row.signatureId === undefined &&
    row.operationKind === "property-set" && row.target.kind === "function-write" &&
    row.receiverType === undefined);
  if (readRows.length === 0 && writeRows.length === 0) return undefined;
  if (source.optionalChain) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_OPTIONAL_CHAIN_UNSUPPORTED",
      reason: "A selected static provider property has no runtime receiver to guard.",
    };
  }
  const needsRead = source.accessMode === "read" || source.accessMode === "read-write";
  const needsWrite = source.accessMode === "write" || source.accessMode === "read-write";
  if ((needsRead && readRows.length !== 1) || (!needsRead && readRows.length > 1) ||
    (needsWrite && writeRows.length !== 1) || (!needsWrite && writeRows.length > 1)) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_OPERATION_AMBIGUOUS",
      reason: "Selected static provider property does not have one exact operation for every requested access mode.",
    };
  }
  const read = needsRead ? instantiateMojoProviderConstantOperation(readRows[0]!) : undefined;
  if (read?.kind === "unsupported") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_READ_NOT_CLOSED",
      reason: read.reason,
    };
  }
  const writeRow = needsWrite ? writeRows[0] : undefined;
  if (writeRow !== undefined && (writeRow.target.kind !== "function-write" ||
    writeRow.parameterTypes?.length !== 1 || writeRow.resultType.kind !== "unit")) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_WRITE_NOT_CLOSED",
      reason: "Selected static provider write has no exact unit-valued single-argument target function.",
    };
  }
  const selectedWrite = writeRow === undefined || source.sourceWriteType === undefined
    ? undefined
    : context.resolveType(source.sourceWriteType);
  if (writeRow !== undefined && selectedWrite === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_WRITE_TYPE_NOT_CLOSED",
      reason: "Selected static provider write has no exact source carrier.",
    };
  }
  const writeValueConversion = selectedWrite === undefined || writeRow?.parameterTypes?.[0] === undefined
    ? undefined
    : classifyMojoValueConversion(selectedWrite, writeRow.parameterTypes[0]);
  if (writeValueConversion?.kind === "unsupported") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_WRITE_CONVERSION_UNPROVEN",
      reason: writeValueConversion.reason,
    };
  }
  let expressionType: MojoTargetTypeRef | undefined;
  let readResultConversion;
  if (read?.kind === "resolved") {
    const selectedRead = source.sourceReadType === undefined
      ? undefined
      : context.resolveType(source.sourceReadType);
    if (selectedRead === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_STATIC_PROPERTY_READ_TYPE_NOT_CLOSED",
        reason: "Selected static provider read has no exact source carrier.",
      };
    }
    const conversion = classifyMojoSourceResultConversion(read.operation.resultType, selectedRead);
    if (conversion.kind === "unsupported") {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_STATIC_PROPERTY_READ_CONVERSION_UNPROVEN",
        reason: conversion.reason,
      };
    }
    expressionType = mojoConvertedValueType(read.operation.resultType, conversion.conversion);
    readResultConversion = conversion.conversion;
  }
  if (expressionType === undefined) {
    expressionType = selectedWrite;
  }
  if (expressionType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_STATIC_PROPERTY_TYPE_NOT_CLOSED",
      reason: "Selected static provider property has no exact source read or write carrier.",
    };
  }
  const writeOperation: MojoSelectedProviderOperation | undefined = writeRow?.target.kind !== "function-write"
    ? undefined
    : Object.freeze({
        target: writeRow.target,
        parameterTypes: Object.freeze([writeRow.parameterTypes![0]!]),
        resultType: writeRow.resultType,
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: writeRow.raises === true,
      });
  return {
    kind: "resolved",
    expressionType,
    selection: Object.freeze({
      kind: "provider-static",
      ...(read?.kind === "resolved" ? { readOperation: read.operation } : {}),
      ...(writeOperation === undefined ? {} : { writeOperation }),
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      ...(selectedWrite === undefined ? {} : { sourceWriteType: selectedWrite }),
      ...(writeRow?.parameterTypes?.[0] === undefined
        ? {}
        : { targetWriteType: writeRow.parameterTypes[0] }),
    }),
  };
}
