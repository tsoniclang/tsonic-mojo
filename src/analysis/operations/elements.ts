import type { Node, ResolvedSourceElementAccessInfo, Type } from "@tsonic/tsts";
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
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { selectedMojoSourceProfileDeclarationIdentity } from "../../policy/operations/source-profile-selection.js";
import type { MojoAnalyzedProjectProperty } from "../program/model.js";
import { instantiateProjectIndexSignature } from "./project-fields.js";

export type MojoElementAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoElementSelection; readonly expressionType: MojoTargetTypeRef }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoElementAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
  readonly conversions: MojoConversionIndex;
  readonly expressionTypes: WeakMap<import("@tsonic/tsts").Node, MojoTargetTypeRef>;
  readonly projectPropertyByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
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
  const project = analyzeProjectIndex(source, accessMode, receiver, index, context);
  if (project !== undefined) return project;
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
  const sourceProfile = analyzeSourceProfileElement(
    source,
    accessMode,
    receiver,
    index,
    context,
  );
  if (sourceProfile !== undefined) return sourceProfile;
  return analyzeNativeElement(source, accessMode, receiver, index, context.conversions);
}

function analyzeProjectIndex(
  source: ResolvedSourceElementAccessInfo,
  accessMode: "read" | "write" | "read-write",
  receiver: MojoTargetTypeRef,
  index: MojoTargetTypeRef,
  context: MojoElementAnalysisContext,
): MojoElementAnalysis | undefined {
  const candidates = [source.selectedDeclaration].map((declaration) => declaration === undefined
    ? undefined
    : context.projectPropertyByDeclaration.get(declaration))
    .filter((candidate): candidate is Extract<MojoAnalyzedProjectProperty, {
      readonly kind: "interface-index-signature";
    }> => candidate?.kind === "interface-index-signature");
  const unique = [...new Set(candidates)];
  if (unique.length === 0) return undefined;
  if (unique.length !== 1) {
    return unsupported(
      "MOJO_PROJECT_INDEX_IDENTITY_CONFLICT",
      "Selected project index evidence resolves to multiple index-signature declarations.",
    );
  }
  const selected = unique[0]!;
  const instantiated = instantiateProjectIndexSignature(selected, receiver);
  if (instantiated === undefined) {
    return unsupported(
      "MOJO_PROJECT_INDEX_INSTANTIATION_UNRESOLVED",
      "Selected project index signature does not exactly instantiate its receiver carrier.",
    );
  }
  if (selected.readonly && accessMode !== "read") {
    return unsupported(
      "MOJO_PROJECT_INDEX_READONLY_WRITE",
      "A readonly project index signature cannot be selected for a write.",
    );
  }
  const indexConversion = context.conversions.record(
    source.argument.expression,
    index,
    instantiated.keyType,
  );
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_PROJECT_INDEX_KEY_CONVERSION_UNPROVEN", indexConversion.reason);
  }
  return {
    kind: "resolved",
    expressionType: instantiated.valueType,
    selection: Object.freeze({
      kind: "project-index",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode,
      receiverType: receiver,
      storageName: selected.storageName,
      indexType: instantiated.keyType,
      ...(accessMode === "read" || accessMode === "read-write"
        ? { readType: instantiated.valueType }
        : {}),
      ...(accessMode === "write" || accessMode === "read-write"
        ? { writeType: instantiated.valueType }
        : {}),
      indexConversion: indexConversion.conversion,
      optionalChain: source.optionalChain,
    }),
  };
}

function analyzeSourceProfileElement(
  source: ResolvedSourceElementAccessInfo,
  accessMode: "read" | "write" | "read-write",
  receiver: MojoTargetTypeRef,
  index: MojoTargetTypeRef,
  context: MojoElementAnalysisContext,
): MojoElementAnalysis | undefined {
  const identity = selectedMojoSourceProfileDeclarationIdentity(
    context.source,
    context.sourceProfiles,
    [source.selectedDeclaration],
  );
  if (identity === undefined) return undefined;
  if (identity.kind !== "indexer" || identity.declaringName === undefined) {
    return unsupported(
      "MOJO_SOURCE_PROFILE_ELEMENT_IDENTITY_INCOMPLETE",
      "The exact selected source-profile element has no index-signature identity.",
    );
  }
  if (identity.profile === "native") {
    return analyzeNativeElement(source, accessMode, receiver, index, context.conversions);
  }
  const owner = identity.declaringName;
  if (owner !== "Array" && owner !== "ReadonlyArray" && owner !== "String") {
    return unsupported(
      "MOJO_SOURCE_PROFILE_ELEMENT_UNSUPPORTED",
      `The exact JavaScript source-profile indexer '${owner}' has no Mojo policy row.`,
    );
  }
  if (owner === "String" && accessMode !== "read") {
    return unsupported(
      "MOJO_JS_STRING_ELEMENT_WRITE_UNSUPPORTED",
      "JavaScript string index access is read-only.",
    );
  }
  if (owner === "ReadonlyArray" && accessMode !== "read") {
    return unsupported(
      "MOJO_JS_READONLY_ARRAY_ELEMENT_WRITE_UNSUPPORTED",
      "ReadonlyArray index access is read-only.",
    );
  }
  const sourceRead = source.sourceReadType === undefined ? undefined : context.resolveType(source.sourceReadType);
  const sourceWrite = source.sourceWriteType === undefined ? undefined : context.resolveType(source.sourceWriteType);
  if ((accessMode === "read" || accessMode === "read-write") && sourceRead === undefined ||
    (accessMode === "write" || accessMode === "read-write") && sourceWrite === undefined) {
    return unsupported(
      "MOJO_SOURCE_PROFILE_ELEMENT_CARRIER_NOT_CLOSED",
      `The exact JavaScript '${owner}' indexer has no closed read or write carrier.`,
    );
  }
  const readOperation: MojoSelectedProviderOperation | undefined = sourceRead === undefined
    ? undefined
    : Object.freeze({
        target: Object.freeze({
          kind: "index-read",
          access: owner === "String"
            ? Object.freeze({ kind: "method" as const, name: "char_at" })
            : Object.freeze({ kind: "element" as const }),
          receiver: "ref",
          index: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        }),
        receiverType: receiver,
        parameterTypes: Object.freeze([index]),
        resultType: sourceRead,
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: false,
      });
  const writeOperation: MojoSelectedProviderOperation | undefined = sourceWrite === undefined
    ? undefined
    : Object.freeze({
        target: Object.freeze({
          kind: "index-write",
          access: Object.freeze({ kind: "element" }),
          receiver: "mut",
          index: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
          value: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        }),
        receiverType: receiver,
        parameterTypes: Object.freeze([index, sourceWrite]),
        resultType: Object.freeze({ kind: "unit" }),
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: false,
      });
  const receiverConversion = classifyMojoValueConversion(receiver, receiver);
  const indexConversion = context.conversions.record(source.argument.expression, index, index);
  if (receiverConversion.kind === "unsupported") {
    return unsupported("MOJO_SOURCE_PROFILE_ELEMENT_RECEIVER_CONFLICT", receiverConversion.reason);
  }
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_SOURCE_PROFILE_ELEMENT_INDEX_CONFLICT", indexConversion.reason);
  }
  const readResultConversion = sourceRead === undefined
    ? undefined
    : classifyMojoValueConversion(sourceRead, sourceRead);
  if (readResultConversion?.kind === "unsupported") {
    return unsupported("MOJO_SOURCE_PROFILE_ELEMENT_READ_CONFLICT", readResultConversion.reason);
  }
  return {
    kind: "resolved",
    expressionType: sourceRead ?? sourceWrite!,
    selection: Object.freeze({
      kind: "provider",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode,
      ...(readOperation === undefined ? {} : { readOperation, readType: sourceRead }),
      ...(writeOperation === undefined ? {} : { writeOperation, writeType: sourceWrite }),
      receiverConversion: receiverConversion.conversion,
      sourceReceiverType: receiver,
      indexConversion: indexConversion.conversion,
      ...(readResultConversion?.kind !== "resolved" ? {} : { readResultConversion: readResultConversion.conversion }),
      optionalChain: source.optionalChain,
    }),
  };
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
    const conversion = classifyMojoValueConversion(readOperation.resultType, sourceRead);
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
    const conversion = classifyMojoValueConversion(target.valueType, target.valueType);
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
