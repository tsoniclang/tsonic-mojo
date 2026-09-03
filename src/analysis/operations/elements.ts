import type { Node, ResolvedSourceElementAccessInfo, Type } from "@tsonic/tsts";
import { tsonicFixedArrayProviderMember } from "@tsonic/source-core/facts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
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
import type { MojoValueRefinementSelection } from "../program/model.js";
import { instantiateProjectIndexSignature } from "./project-fields.js";
import { classifyMojoValueRefinement } from "../refinements/value.js";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import { mojoPrimitiveTargetType } from "../../target-model/types/constructors.js";
import { analyzeNativeElement } from "./native-elements.js";
import {
  sourceProfileRegExpElementType,
  sourceProfileRegExpNamedValueType,
} from "../../policy/types/js-regexp.js";

export type MojoElementAnalysis =
  | {
      readonly kind: "resolved";
      readonly selection: MojoElementSelection;
      readonly expressionType: MojoTargetTypeRef;
      readonly valueRefinement?: MojoValueRefinementSelection;
    }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoElementAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
  readonly conversions: MojoConversionIndex;
  readonly expressionTypes: WeakMap<import("@tsonic/tsts").Node, MojoTargetTypeRef>;
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly projectPropertyByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
  readonly projectRelationships: MojoProjectTypeRelationships;
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
      return analyzeNativeElement(source, accessMode, receiver, index, context);
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
  return analyzeNativeElement(source, accessMode, receiver, index, context);
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
  const instantiated = instantiateProjectIndexSignature(
    selected,
    receiver,
    context.projectRelationships,
  );
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
      declaration: selected.declaration,
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
    return analyzeNativeElement(source, accessMode, receiver, index, context);
  }
  const owner = identity.declaringName;
  const regexpElement = sourceProfileRegExpElementType(receiver);
  const regexpNamedValue = sourceProfileRegExpNamedValueType(receiver);
  if (owner !== "Array" && owner !== "ReadonlyArray" && owner !== "String" &&
    regexpNamedValue === undefined) {
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
  const readContract = source.sourceReadType === undefined
    ? undefined
    : sourceProfileElementReadContract(owner, receiver, source, context);
  const sourceRead = readContract?.expressionType;
  const receiverElement = sourceProfileReceiverElement(receiver);
  const sourceWrite = source.sourceWriteType === undefined
    ? undefined
    : owner === "Array" || regexpNamedValue !== undefined
      ? receiverElement ?? regexpNamedValue
      : context.resolveType(source.sourceWriteType);
  if ((accessMode === "read" || accessMode === "read-write") && sourceRead === undefined ||
    (accessMode === "write" || accessMode === "read-write") && sourceWrite === undefined) {
    return unsupported(
      "MOJO_SOURCE_PROFILE_ELEMENT_CARRIER_NOT_CLOSED",
      `The exact JavaScript '${owner}' indexer has no closed read or write carrier.`,
    );
  }
  if (source.sourceReadType !== undefined && readContract === undefined) {
    return unsupported(
      "MOJO_SOURCE_PROFILE_ELEMENT_READ_CONTRACT_UNCLOSED",
      `The exact JavaScript '${owner}' index result has no closed Mojo read contract.`,
    );
  }
  const targetIndex = regexpNamedValue === undefined
    ? mojoPrimitiveTargetType("float64")
    : Object.freeze({ kind: "native-string" as const });
  const readOperation: MojoSelectedProviderOperation | undefined = readContract === undefined
    ? undefined
    : Object.freeze({
        target: Object.freeze({
          kind: "index-read",
          access: readContract.access,
          receiver: "ref",
          index: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        }),
        receiverType: receiver,
        parameterTypes: Object.freeze([targetIndex]),
        resultType: readContract.operationResultType,
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: readContract.raises,
      });
  const writeOperation: MojoSelectedProviderOperation | undefined = sourceWrite === undefined
    ? undefined
    : Object.freeze({
        target: Object.freeze({
          kind: "index-write",
          access: regexpElement === undefined && regexpNamedValue === undefined
            ? Object.freeze({ kind: "element" as const })
            : Object.freeze({
                kind: "method" as const,
                name: regexpNamedValue === undefined ? "set_index" : "set",
              }),
          receiver: "mut",
          index: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
          value: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        }),
        receiverType: receiver,
        parameterTypes: Object.freeze([targetIndex, sourceWrite]),
        resultType: Object.freeze({ kind: "unit" }),
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: false,
      });
  const receiverConversion = classifyMojoRefinedValueConversion(
    receiver,
    receiver,
    context.valueRefinements.get(source.receiver.expression),
  );
  const indexConversion = context.conversions.record(source.argument.expression, index, targetIndex);
  if (receiverConversion.kind === "unsupported") {
    return unsupported("MOJO_SOURCE_PROFILE_ELEMENT_RECEIVER_CONFLICT", receiverConversion.reason);
  }
  if (indexConversion.kind === "unsupported") {
    return unsupported("MOJO_SOURCE_PROFILE_ELEMENT_INDEX_CONFLICT", indexConversion.reason);
  }
  const writeValueConversion = sourceWrite === undefined
    ? undefined
    : classifyMojoValueConversion(sourceWrite, sourceWrite);
  if (writeValueConversion?.kind === "unsupported") {
    return unsupported("MOJO_SOURCE_PROFILE_ELEMENT_WRITE_CONVERSION_UNPROVEN", writeValueConversion.reason);
  }
  return {
    kind: "resolved",
    expressionType: sourceRead ?? sourceWrite!,
    ...(readContract?.valueRefinement === undefined
      ? {}
      : { valueRefinement: readContract.valueRefinement }),
    selection: Object.freeze({
      kind: "provider",
      receiver: source.receiver.expression,
      index: source.argument.expression,
      accessMode,
      ...(readOperation === undefined ? {} : { readOperation, readType: sourceRead }),
      ...(writeOperation === undefined ? {} : { writeOperation, writeType: sourceWrite }),
      ...(sourceWrite === undefined ? {} : { sourceWriteType: sourceWrite }),
      ...(sourceWrite === undefined ? {} : { targetWriteType: sourceWrite }),
      receiverConversion: receiverConversion.conversion,
      sourceReceiverType: receiver,
      indexConversion: indexConversion.conversion,
      optionalChain: source.optionalChain,
    }),
  };
}

function sourceProfileReceiverElement(
  receiver: MojoTargetTypeRef,
): MojoTargetTypeRef | undefined {
  const value = receiver.kind === "optional" ? receiver.value : receiver;
  const regexpElement = sourceProfileRegExpElementType(value);
  if (regexpElement !== undefined) return regexpElement;
  if (value.kind !== "target-named" || value.id !== "tsonic.mojo.js.JsArray") return undefined;
  const argument = value.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

function sourceProfileElementReadContract(
  owner: string,
  receiver: MojoTargetTypeRef,
  source: ResolvedSourceElementAccessInfo,
  context: MojoElementAnalysisContext,
): {
  readonly access: { readonly kind: "element" } | { readonly kind: "method"; readonly name: string };
  readonly operationResultType: MojoTargetTypeRef;
  readonly expressionType: MojoTargetTypeRef;
  readonly valueRefinement?: MojoValueRefinementSelection;
  readonly raises: boolean;
} | undefined {
  if (source.sourceReadType === undefined) return undefined;
  const semantics = context.source.semantics.forNode(source.expression);
  const selectedSourceRead = source.sourceReadType;
  const presentSourceRead = semantics.types.withoutMissingOrUndefined(selectedSourceRead);
  if (presentSourceRead === undefined) return undefined;
  const regexpElement = sourceProfileRegExpElementType(receiver);
  if (regexpElement !== undefined) {
    return Object.freeze({
      access: Object.freeze({ kind: "method", name: "get_index" }),
      operationResultType: regexpElement,
      expressionType: regexpElement,
      raises: false,
    });
  }
  const regexpNamedValue = sourceProfileRegExpNamedValueType(receiver);
  if (regexpNamedValue !== undefined) {
    return Object.freeze({
      access: Object.freeze({ kind: "method", name: "get" }),
      operationResultType: regexpNamedValue,
      expressionType: regexpNamedValue,
      raises: false,
    });
  }
  if (owner === "String") {
    const valueType = receiver.kind === "optional" ? receiver.value : receiver;
    if (semantics.types.isStringLike(selectedSourceRead)) {
      return Object.freeze({
        access: Object.freeze({ kind: "method", name: "char_at" }),
        operationResultType: valueType,
        expressionType: valueType,
        raises: false,
      });
    }
    return semantics.types.isStringLike(presentSourceRead)
      ? Object.freeze({
          access: Object.freeze({ kind: "method", name: "get_index" }),
          operationResultType: Object.freeze({ kind: "optional", value: valueType }),
          expressionType: Object.freeze({ kind: "optional", value: valueType }),
          raises: false,
        })
      : undefined;
  }
  const argument = receiver.kind === "target-named" &&
      receiver.id === "tsonic.mojo.js.JsArray"
    ? receiver.genericArguments?.[0]
    : undefined;
  const element = argument?.kind === "type" ? argument.type : undefined;
  if (element === undefined) return undefined;
  const sourceArguments = semantics.types.effectiveTypeArguments(source.receiver.type) ??
    semantics.types.typeArguments(source.receiver.type);
  const sourceElement = sourceArguments.length === 1 ? sourceArguments[0] : undefined;
  if (sourceElement === undefined) return undefined;
  if (semantics.types.isIdentical(selectedSourceRead, sourceElement)) {
    return Object.freeze({
      access: Object.freeze({ kind: "element" }),
      operationResultType: element,
      expressionType: element,
      raises: true,
    });
  }
  if (semantics.types.isIdentical(presentSourceRead, sourceElement)) {
    const optionalElement = Object.freeze({ kind: "optional" as const, value: element });
    return Object.freeze({
      access: Object.freeze({ kind: "method", name: "get_index" }),
      operationResultType: optionalElement,
      expressionType: optionalElement,
      raises: false,
    });
  }
  const sourceRefinement = semantics.types.refinement(sourceElement, selectedSourceRead);
  if (sourceRefinement.kind !== "members" || sourceRefinement.types.length === 0) return undefined;
  const selectedTarget = context.resolveType(selectedSourceRead);
  const valueRefinement = selectedTarget === undefined
    ? undefined
    : classifyMojoValueRefinement(element, selectedTarget);
  return valueRefinement === undefined
    ? undefined
    : Object.freeze({
        access: Object.freeze({ kind: "element" }),
        operationResultType: element,
        expressionType: valueRefinement.resultType,
        valueRefinement,
        raises: true,
      });
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
    const conversion = classifyMojoValueConversion(readOperation.resultType, sourceRead);
    if (conversion.kind === "unsupported") {
      return unsupported("MOJO_PROVIDER_ELEMENT_READ_CONVERSION_UNPROVEN", conversion.reason);
    }
    expressionType = sourceRead;
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
