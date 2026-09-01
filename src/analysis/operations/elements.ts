import type { ResolvedSourceElementAccessInfo, Type } from "@tsonic/tsts";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import type { MojoElementSelection } from "../program/model.js";
import type {
  MojoSelectedProviderOperation,
} from "../../target-model/operations/selection.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import { instantiateMojoProviderPropertyOperation } from "../../policy/operations/provider-instantiation.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";

export type MojoElementAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoElementSelection; readonly expressionType: MojoTargetTypeRef }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoElementAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
  readonly conversions: MojoConversionIndex;
  readonly expressionTypes: WeakMap<import("@tsonic/tsts").Node, MojoTargetTypeRef>;
}

export function analyzeMojoElementAccess(
  source: ResolvedSourceElementAccessInfo,
  context: MojoElementAnalysisContext,
): MojoElementAnalysis {
  if (source.callCallee) {
    return unsupported(
      "MOJO_ELEMENT_CALL_CALLEE_UNSUPPORTED",
      "Calling an element-selected callable requires a sealed callable-value ABI.",
    );
  }
  if (source.accessMode === "delete") {
    return unsupported(
      "MOJO_ELEMENT_DELETE_UNSUPPORTED",
      "Selected element access has no exact target delete operation.",
    );
  }
  const accessMode: "read" | "write" | "read-write" = source.accessMode;
  const receiver = context.expressionTypes.get(source.receiver.expression) ??
    context.resolveType(source.receiver.type);
  const index = context.expressionTypes.get(source.argument.expression) ??
    context.resolveType(source.argument.type);
  if (receiver === undefined || index === undefined) {
    return unsupported(
      "MOJO_ELEMENT_OPERAND_CARRIER_NOT_CLOSED",
      "Selected element receiver or index has no exact Mojo carrier.",
    );
  }
  const identity = selectedProviderDeclarationIdentity(context.source, [
    source.selectedDeclaration,
    source.selectedSymbol,
    source.sourceDeclaration,
    source.sourceSymbol,
  ]);
  if (identity !== undefined) {
    if (tsonicFixedArrayProviderMember(identity) === "index") {
      return analyzeNativeElement(source, accessMode, receiver, index, context.conversions);
    }
    return analyzeProviderElement(source, accessMode, receiver, index, identity, context);
  }
  return analyzeNativeElement(source, accessMode, receiver, index, context.conversions);
}

function analyzeProviderElement(
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
  const receiverConversion = classifyMojoValueConversion(receiver, receiverTarget);
  const indexConversion = context.conversions.record(source.argument.expression, index, indexTarget);
  if (receiverConversion.kind === "unsupported") {
    return unsupported("MOJO_PROVIDER_ELEMENT_RECEIVER_CONVERSION_UNPROVEN", receiverConversion.reason);
  }
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_PROVIDER_ELEMENT_INDEX_CONVERSION_UNPROVEN", indexConversion.reason);
  }
  let expressionType: MojoTargetTypeRef;
  let readResultConversion;
  if (readOperation !== undefined) {
    const sourceRead = source.sourceReadType === undefined ? undefined : context.resolveType(source.sourceReadType);
    if (sourceRead === undefined) {
      return unsupported("MOJO_PROVIDER_ELEMENT_READ_CARRIER_NOT_CLOSED", "Selected provider element read has no exact source carrier.");
    }
    const conversion = context.conversions.record(source.expression, readOperation.resultType, sourceRead);
    if (conversion.kind === "unsupported") {
      return unsupported("MOJO_PROVIDER_ELEMENT_READ_CONVERSION_UNPROVEN", conversion.reason);
    }
    expressionType = sourceRead;
    readResultConversion = conversion.conversion;
  } else {
    const sourceWrite = source.sourceWriteType === undefined ? undefined : context.resolveType(source.sourceWriteType);
    if (sourceWrite === undefined || writeType === undefined) {
      return unsupported("MOJO_PROVIDER_ELEMENT_WRITE_CARRIER_NOT_CLOSED", "Selected provider element write has no exact source and target carriers.");
    }
    expressionType = sourceWrite;
  }
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
      receiverConversion: receiverConversion.conversion,
      sourceReceiverType: receiver,
      indexConversion: indexConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      optionalChain: source.optionalChain,
    }),
  };
}

function analyzeNativeElement(
  source: ResolvedSourceElementAccessInfo,
  accessMode: "read" | "write" | "read-write",
  receiver: MojoTargetTypeRef,
  index: MojoTargetTypeRef,
  conversions: MojoConversionIndex,
): MojoElementAnalysis {
  const target = nativeElementContract(receiver, source.selectedElementIndex);
  if (target === undefined) {
    return unsupported(
      "MOJO_ELEMENT_TARGET_UNSUPPORTED",
      "Selected element receiver has no exact native Mojo element contract.",
    );
  }
  const indexConversion = conversions.record(source.argument.expression, index, target.indexType);
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_ELEMENT_INDEX_CONVERSION_UNPROVEN", indexConversion.reason);
  }
  let expressionType: MojoTargetTypeRef;
  let readResultConversion;
  if (source.sourceReadType !== undefined) {
    const conversion = conversions.record(source.expression, target.valueType, target.valueType);
    expressionType = target.valueType;
    readResultConversion = conversion.kind === "resolved" ? conversion.conversion : undefined;
  } else {
    if (source.sourceWriteType === undefined) {
      return unsupported("MOJO_ELEMENT_WRITE_CARRIER_NOT_CLOSED", "Selected element write has no exact Mojo carrier.");
    }
    expressionType = target.valueType;
  }
  return {
    kind: "resolved",
    expressionType,
    selection: Object.freeze({
      kind: "native",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode,
      receiverType: receiver,
      indexType: target.indexType,
      ...(source.sourceReadType === undefined ? {} : { readType: target.valueType }),
      ...(source.sourceWriteType === undefined ? {} : { writeType: target.valueType }),
      indexConversion: indexConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion }),
      ...(source.selectedElementIndex === undefined ? {} : { selectedElementIndex: source.selectedElementIndex }),
      optionalChain: source.optionalChain,
    }),
  };
}

function nativeElementContract(
  receiver: MojoTargetTypeRef,
  selectedElementIndex: number | undefined,
): { readonly indexType: MojoTargetTypeRef; readonly valueType: MojoTargetTypeRef } | undefined {
  const nativeIndex: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: "native-int" });
  switch (receiver.kind) {
    case "list": return { indexType: nativeIndex, valueType: receiver.element };
    case "fixed-array": return { indexType: nativeIndex, valueType: receiver.element };
    case "dictionary": return { indexType: receiver.key, valueType: receiver.value };
    case "tuple": {
      const element = selectedElementIndex === undefined ? undefined : receiver.elements[selectedElementIndex];
      return element === undefined ? undefined : { indexType: nativeIndex, valueType: element };
    }
    default: return undefined;
  }
}

function unsupported(code: string, reason: string): MojoElementAnalysis {
  return { kind: "unsupported", code, reason };
}
