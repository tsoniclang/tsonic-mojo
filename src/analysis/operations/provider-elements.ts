import type { ResolvedSourceElementAccessInfo } from "@tsonic/tsts";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { instantiateMojoProviderPropertyOperation } from "../../policy/operations/provider-instantiation.js";
import type { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import { classifyMojoSourceResultConversion, mojoConvertedValueType } from "./call-results.js";
import type { MojoElementAnalysis, MojoElementAnalysisContext } from "./elements.js";

export function analyzeProviderElement(
  source: ResolvedSourceElementAccessInfo,
  accessMode: "read" | "write" | "read-write",
  receiver: MojoTargetTypeRef,
  index: MojoTargetTypeRef,
  identity: NonNullable<ReturnType<typeof selectedProviderDeclarationIdentity>>,
  context: MojoElementAnalysisContext,
): MojoElementAnalysis {
  if (identity.exportId === undefined || identity.memberId === undefined || identity.signatureId === undefined) {
    return unsupported(
      "MOJO_PROVIDER_ELEMENT_IDENTITY_INCOMPLETE",
      "Selected provider element access has no exact export, member, and index-signature identity.",
    );
  }
  const select = (
    operationKind: "indexer" | "index-set",
  ): MojoSelectedProviderOperation | MojoElementAnalysis | undefined => {
    const rows = context.providerSemantics.operations.filter((row) =>
      providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
      row.memberId === identity.memberId && row.signatureId === identity.signatureId &&
      row.operationKind === operationKind);
    if (rows.length !== 1) {
      return unsupported(
        rows.length === 0 ? "MOJO_PROVIDER_ELEMENT_OPERATION_MISSING" : "MOJO_PROVIDER_ELEMENT_OPERATION_AMBIGUOUS",
        `Selected provider ${operationKind} has ${rows.length} exact Mojo operation rows.`,
      );
    }
    const instantiated = instantiateMojoProviderPropertyOperation(rows[0]!, receiver);
    return instantiated.kind === "unsupported"
      ? unsupported("MOJO_PROVIDER_ELEMENT_NOT_CLOSED", instantiated.reason)
      : instantiated.operation;
  };
  const read = source.accessMode === "read" || source.accessMode === "read-write"
    ? select("indexer")
    : undefined;
  const write = source.accessMode === "write" || source.accessMode === "read-write"
    ? select("index-set")
    : undefined;
  if (read !== undefined && "kind" in read) return read;
  if (write !== undefined && "kind" in write) return write;
  const readOperation = read as MojoSelectedProviderOperation | undefined;
  const writeOperation = write as MojoSelectedProviderOperation | undefined;
  const receiverTarget = readOperation?.receiverType ?? writeOperation?.receiverType;
  const readIndex = readOperation?.parameterTypes[0];
  const writeIndex = writeOperation?.parameterTypes[0];
  const indexTarget = readIndex ?? writeIndex;
  const writeType = writeOperation?.parameterTypes[1];
  if (receiverTarget === undefined || indexTarget === undefined ||
    (readOperation !== undefined && (readOperation.target.kind !== "index-read" || readOperation.parameterTypes.length !== 1)) ||
    (writeOperation !== undefined && (writeOperation.target.kind !== "index-write" || writeOperation.parameterTypes.length !== 2 || writeType === undefined))) {
    return unsupported(
      "MOJO_PROVIDER_ELEMENT_ABI_INCOMPLETE",
      "Selected provider element access has no closed receiver, index, and value ABI.",
    );
  }
  if ((readOperation?.receiverType !== undefined && writeOperation?.receiverType !== undefined &&
      !mojoTargetTypeEquals(readOperation.receiverType, writeOperation.receiverType)) ||
    (readIndex !== undefined && writeIndex !== undefined && !mojoTargetTypeEquals(readIndex, writeIndex))) {
    return unsupported(
      "MOJO_PROVIDER_ELEMENT_ABI_CONFLICT",
      "Selected provider element read and write require different receiver or index carriers.",
    );
  }
  const receiverConversion = classifyMojoRefinedValueConversion(
    receiver,
    receiverTarget,
    context.valueRefinements.get(source.receiver.expression),
  );
  const indexConversion = context.conversions.record(source.argument.expression, index, indexTarget);
  if (receiverConversion.kind === "unsupported") {
    return unsupported("MOJO_PROVIDER_ELEMENT_RECEIVER_CONVERSION_UNPROVEN", receiverConversion.reason);
  }
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_PROVIDER_ELEMENT_INDEX_CONVERSION_UNPROVEN", indexConversion.reason);
  }
  const sourceWrite = writeOperation === undefined || source.sourceWriteType === undefined
    ? undefined
    : context.resolveType(source.sourceWriteType);
  if (writeOperation !== undefined && (sourceWrite === undefined || writeType === undefined)) {
    return unsupported(
      "MOJO_PROVIDER_ELEMENT_WRITE_CARRIER_NOT_CLOSED",
      "Selected provider element write has no exact source and target carriers.",
    );
  }
  const writeValueConversion = sourceWrite === undefined || writeType === undefined
    ? undefined
    : classifyMojoValueConversion(sourceWrite, writeType);
  if (writeValueConversion?.kind === "unsupported") {
    return unsupported("MOJO_PROVIDER_ELEMENT_WRITE_CONVERSION_UNPROVEN", writeValueConversion.reason);
  }
  let expressionType: MojoTargetTypeRef;
  let readResultConversion;
  if (readOperation !== undefined) {
    const sourceRead = source.sourceReadType === undefined ? undefined : context.resolveType(source.sourceReadType);
    if (sourceRead === undefined) {
      return unsupported("MOJO_PROVIDER_ELEMENT_READ_CARRIER_NOT_CLOSED", "Selected provider element read has no exact source carrier.");
    }
    const conversion = classifyMojoSourceResultConversion(readOperation.resultType, sourceRead);
    if (conversion.kind === "unsupported") {
      return unsupported("MOJO_PROVIDER_ELEMENT_READ_CONVERSION_UNPROVEN", conversion.reason);
    }
    expressionType = mojoConvertedValueType(readOperation.resultType, conversion.conversion);
    readResultConversion = conversion.conversion;
  } else expressionType = sourceWrite!;
  return {
    kind: "resolved",
    expressionType,
    selection: Object.freeze({
      kind: "provider",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode,
      ...(readOperation === undefined ? {} : { readOperation, readType: readOperation.resultType }),
      ...(writeOperation === undefined ? {} : { writeOperation, writeType }),
      ...(sourceWrite === undefined ? {} : { sourceWriteType: sourceWrite }),
      ...(writeType === undefined ? {} : { targetWriteType: writeType }),
      receiverConversion: receiverConversion.conversion,
      sourceReceiverType: receiver,
      indexConversion: indexConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      optionalChain: source.optionalChain,
    }),
  };
}

function unsupported(code: string, reason: string): MojoElementAnalysis {
  return { kind: "unsupported", code, reason };
}
