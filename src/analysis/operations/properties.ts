import type { Node, ResolvedSourcePropertyAccessInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import type { MojoPropertySelection } from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import {
  instantiateMojoProviderConstantOperation,
  instantiateMojoProviderPropertyOperation,
} from "../../policy/operations/provider-instantiation.js";
import {
  resolveProviderDeclarationIdentity,
  selectedProviderDeclarationIdentity,
} from "../../policy/operations/provider-selection.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { selectedMojoSourceProfileDeclarationIdentity } from "../../policy/operations/source-profile-selection.js";
import { analyzeStaticProviderProperty } from "./static-provider-properties.js";
import { sourceProfileRegExpPropertyAccess } from "../../policy/operations/source-profile-regexp-properties.js";
import {
  classifyMojoSourceResultConversion,
  mojoConvertedValueType,
} from "./call-results.js";

export type MojoPropertyAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoPropertySelection; readonly expressionType: MojoTargetTypeRef }
  | { readonly kind: "not-project-field" }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoProviderPropertyAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly conversions: MojoConversionIndex;
  readonly valueRefinements: WeakMap<Node, import("../program/model.js").MojoValueRefinementSelection>;
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
  const sourceProfile = analyzeSourceProfileProperty(source, context);
  if (sourceProfile !== undefined) return sourceProfile;
  const exactSubjects = source.accessMode === "read"
    ? [source.selectedReadDeclaration ?? source.selectedDeclaration]
    : source.accessMode === "write"
      ? [source.selectedWriteDeclaration ?? source.selectedDeclaration]
      : [
          source.selectedReadDeclaration ?? source.selectedDeclaration,
          source.selectedWriteDeclaration ?? source.selectedDeclaration,
        ];
  const exactIdentity = resolveProviderDeclarationIdentity(context.source, exactSubjects);
  if (exactIdentity.kind === "conflict") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_IDENTITY_CONFLICT",
      reason: "The exact checker-selected provider property declarations have conflicting identities.",
    };
  }
  const selectedIdentity = exactIdentity.kind === "selected"
    ? exactIdentity.identity
    : selectedProviderDeclarationIdentity(context.source, [
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
      (row.target.kind === "constant" || row.target.kind === "function-read"));
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
    const conversion = classifyMojoSourceResultConversion(
      instantiated.operation.resultType,
      selectedRead,
    );
    return conversion.kind === "unsupported"
      ? { kind: "unsupported", code: "MOJO_PROVIDER_CONSTANT_CONVERSION_UNPROVEN", reason: conversion.reason }
      : {
          kind: "resolved",
          expressionType: mojoConvertedValueType(
            instantiated.operation.resultType,
            conversion.conversion,
          ),
          selection: Object.freeze({
            kind: "provider-constant",
            operation: instantiated.operation,
            readResultConversion: conversion.conversion,
          }),
        };
  }
  const staticProperty = selectedIdentity?.memberId === undefined
    ? undefined
    : analyzeStaticProviderProperty(source, selectedIdentity, context);
  if (staticProperty !== undefined) return staticProperty;
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
  const receiverConversion = classifyMojoRefinedValueConversion(
    receiverType,
    receiverTarget,
    context.valueRefinements.get(source.receiver.expression),
  );
  if (receiverConversion.kind === "unsupported") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_RECEIVER_CONVERSION_UNPROVEN",
      reason: receiverConversion.reason,
    };
  }
  const selectedWrite = write === undefined || source.sourceWriteType === undefined
    ? undefined
    : context.resolveType(source.sourceWriteType);
  if (write !== undefined && selectedWrite === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_WRITE_TYPE_NOT_CLOSED",
      reason: "Selected provider property write has no exact source carrier.",
    };
  }
  const writeParameterType = write?.operation.parameterTypes[0];
  if (write !== undefined && (write.operation.parameterTypes.length !== 1 || writeParameterType === undefined)) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_WRITE_ABI_MISSING",
      reason: "Selected provider property write has no exact single-value target ABI.",
    };
  }
  const writeValueConversion = selectedWrite === undefined || writeParameterType === undefined
    ? undefined
    : classifyMojoValueConversion(selectedWrite, writeParameterType);
  if (writeValueConversion?.kind === "unsupported") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_PROPERTY_WRITE_CONVERSION_UNPROVEN",
      reason: writeValueConversion.reason,
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
    const conversion = classifyMojoSourceResultConversion(read.operation.resultType, selectedRead);
    if (conversion.kind === "unsupported") {
      return { kind: "unsupported", code: "MOJO_PROVIDER_PROPERTY_READ_CONVERSION_UNPROVEN", reason: conversion.reason };
    }
    expressionType = mojoConvertedValueType(read.operation.resultType, conversion.conversion);
    readResultConversion = conversion.conversion;
  } else expressionType = selectedWrite!;
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
      ...(selectedWrite === undefined ? {} : { sourceWriteType: selectedWrite }),
      ...(writeParameterType === undefined ? {} : { targetWriteType: writeParameterType }),
      optionalChain: source.optionalChain,
    }),
  };
}

function analyzeSourceProfileProperty(
  source: ResolvedSourcePropertyAccessInfo,
  context: MojoProviderPropertyAnalysisContext,
): MojoPropertyAnalysis | undefined {
  const identity = selectedMojoSourceProfileDeclarationIdentity(
    context.source,
    context.sourceProfiles,
    [source.selectedDeclaration, source.selectedReadDeclaration, source.selectedWriteDeclaration],
  );
  if (identity === undefined) return undefined;
  const owner = identity.declaringName;
  const member = identity.name;
  if (owner === undefined || member === undefined || identity.kind !== "member") {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_PROPERTY_IDENTITY_INCOMPLETE",
      reason: "The exact selected source-profile property has no owner and member identity.",
    };
  }
  const constantName = sourceProfileConstantName(identity.profile, owner, member);
  if (constantName !== undefined) {
    if (source.accessMode !== "read" || source.sourceReadType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_CONSTANT_WRITE_UNSUPPORTED",
        reason: `The source-profile constant '${owner}.${member}' is immutable.`,
      };
    }
    const resultType = context.resolveType(source.sourceReadType);
    if (resultType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_CONSTANT_TYPE_NOT_CLOSED",
        reason: `The source-profile constant '${owner}.${member}' has no exact Mojo carrier.`,
      };
    }
    const operation: MojoSelectedProviderOperation = Object.freeze({
      target: Object.freeze({
        kind: "constant",
        modulePath: Object.freeze(["tsonic_js"]),
        name: constantName,
      }),
      parameterTypes: Object.freeze([]),
      resultType,
      genericArguments: Object.freeze([]),
      genericParameters: Object.freeze([]),
      raises: false,
    });
    const conversion = classifyMojoValueConversion(resultType, resultType);
    return conversion.kind === "unsupported"
      ? { kind: "unsupported", code: "MOJO_SOURCE_PROFILE_CONSTANT_CONVERSION_UNPROVEN", reason: conversion.reason }
      : {
          kind: "resolved",
          expressionType: resultType,
          selection: Object.freeze({
            kind: "provider-constant",
            operation,
            readResultConversion: conversion.conversion,
          }),
        };
  }
  const receiverType = context.resolveType(source.receiver.type);
  if (receiverType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_PROPERTY_RECEIVER_NOT_CLOSED",
      reason: `The source-profile property '${owner}.${member}' has no exact receiver carrier.`,
    };
  }
  const access = sourceProfilePropertyAccess(identity.profile, owner, member, receiverType);
  if (access === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_PROPERTY_UNSUPPORTED",
      reason: `The exact source-profile property '${owner}.${member}' has no Mojo policy row.`,
    };
  }
  const receiverConversion = classifyMojoRefinedValueConversion(
    receiverType,
    receiverType,
    context.valueRefinements.get(source.receiver.expression),
  );
  if (receiverConversion.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_SOURCE_PROFILE_PROPERTY_RECEIVER_CONFLICT", reason: receiverConversion.reason };
  }
  const readType = source.sourceReadType === undefined ? undefined : context.resolveType(source.sourceReadType);
  const writeType = source.sourceWriteType === undefined ? undefined : context.resolveType(source.sourceWriteType);
  if ((source.accessMode === "read" || source.accessMode === "read-write") && readType === undefined ||
    (source.accessMode === "write" || source.accessMode === "read-write") && writeType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_PROPERTY_CARRIER_NOT_CLOSED",
      reason: `The source-profile property '${owner}.${member}' has no exact read or write carrier.`,
    };
  }
  if (writeType !== undefined && access.write === undefined && access.read.kind === "method") {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_METHOD_PROPERTY_WRITE_UNSUPPORTED",
      reason: `The computed source-profile property '${owner}.${member}' is not a writable Mojo location.`,
    };
  }
  const storageType = access.storageType;
  const readStorageType = access.resultType ?? storageType ?? readType;
  const writeStorageType = storageType ?? writeType;
  const readOperation: MojoSelectedProviderOperation | undefined = readType === undefined
    ? undefined
    : Object.freeze({
        target: Object.freeze({
          kind: "property-read",
          access: access.read,
          receiver: "ref",
        }),
        receiverType,
        parameterTypes: Object.freeze([]),
        resultType: readStorageType!,
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: access.raises,
      });
  const writeOperation: MojoSelectedProviderOperation | undefined = writeType === undefined
    ? undefined
    : Object.freeze({
        target: Object.freeze({
          kind: "property-write",
          access: access.write ?? Object.freeze({ kind: "member", name: access.read.name }),
          receiver: "mut",
          value: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        }),
        receiverType,
        parameterTypes: Object.freeze([writeStorageType!]),
        resultType: Object.freeze({ kind: "unit" }),
        genericArguments: Object.freeze([]),
        genericParameters: Object.freeze([]),
        raises: access.raises,
      });
  const readResultConversion = readType === undefined
    ? undefined
    : classifyMojoValueConversion(
        readStorageType!,
        readType,
      );
  if (readResultConversion?.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_SOURCE_PROFILE_PROPERTY_READ_CONVERSION_UNPROVEN", reason: readResultConversion.reason };
  }
  const writeValueConversion = writeType === undefined
    ? undefined
    : classifyMojoValueConversion(writeType, writeStorageType!);
  if (writeValueConversion?.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_SOURCE_PROFILE_PROPERTY_WRITE_CONVERSION_UNPROVEN", reason: writeValueConversion.reason };
  }
  return {
    kind: "resolved",
    expressionType: readType ?? writeType!,
    selection: Object.freeze({
      kind: "provider",
      ...(readOperation === undefined ? {} : { readOperation }),
      ...(writeOperation === undefined ? {} : { writeOperation }),
      receiver: source.receiver.expression,
      sourceReceiverType: receiverType,
      receiverConversion: receiverConversion.conversion,
      ...(readResultConversion === undefined ? {} : { readResultConversion: readResultConversion.conversion }),
      ...(writeType === undefined ? {} : { sourceWriteType: writeType }),
      ...(writeStorageType === undefined ? {} : { targetWriteType: writeStorageType }),
      optionalChain: source.optionalChain,
    }),
  };
}

function sourceProfilePropertyAccess(
  profile: "native" | "js",
  owner: string,
  member: string,
  receiver: MojoTargetTypeRef,
): {
  readonly read:
    | { readonly kind: "member" | "method"; readonly name: string }
    | { readonly kind: "function"; readonly modulePath: readonly string[]; readonly name: string };
  readonly write?: { readonly kind: "member" | "method"; readonly name: string };
  readonly resultType?: MojoTargetTypeRef;
  readonly storageType?: MojoTargetTypeRef;
  readonly raises: boolean;
} | undefined {
  const regexp = profile === "js"
    ? sourceProfileRegExpPropertyAccess(owner, member, receiver)
    : undefined;
  if (regexp !== undefined) return regexp;
  if (owner === "Error") {
    const nativeString = Object.freeze({ kind: "native-string" as const });
    if (member === "name" || member === "message") {
      return {
        read: Object.freeze({ kind: "member", name: member }),
        write: Object.freeze({ kind: "member", name: member }),
        resultType: nativeString,
        storageType: nativeString,
        raises: false,
      };
    }
    if (member === "stack") {
      const stack = Object.freeze({ kind: "optional" as const, value: nativeString });
      return {
        read: Object.freeze({ kind: "member", name: "stack" }),
        write: Object.freeze({ kind: "member", name: "stack" }),
        resultType: stack,
        storageType: stack,
        raises: false,
      };
    }
  }
  if (profile === "native") {
    if (owner === "String" && member === "length" && receiver.kind === "native-string") {
      return {
        read: Object.freeze({
          kind: "function",
          modulePath: Object.freeze(["tsonic_runtime"]),
          name: "source_string_length",
        }),
        raises: false,
      };
    }
    if ((owner === "Array" || owner === "ReadonlyArray") && member === "length" &&
      hasNativeLength(receiver)) {
      return {
        read: Object.freeze({ kind: "method", name: "__len__" }),
        resultType: Object.freeze({ kind: "source-primitive", name: "native-int" }),
        raises: false,
      };
    }
    if ((owner === "Map" || owner === "ReadonlyMap" || owner === "Set" || owner === "ReadonlySet") && member === "size" &&
      hasNativeLength(receiver)) {
      return {
        read: Object.freeze({ kind: "method", name: "__len__" }),
        resultType: Object.freeze({ kind: "source-primitive", name: "native-int" }),
        raises: false,
      };
    }
    return undefined;
  }
  if (owner === "String" && member === "length" && receiver.kind === "native-string") {
    return {
      read: Object.freeze({
        kind: "function",
        modulePath: Object.freeze(["tsonic_runtime"]),
        name: "source_string_length",
      }),
      raises: false,
    };
  }
  if ((owner === "Array" || owner === "ReadonlyArray") && member === "length" &&
    hasNativeLength(receiver)) {
    return {
      read: Object.freeze({ kind: "method", name: "__len__" }),
      resultType: Object.freeze({ kind: "source-primitive", name: "native-int" }),
      raises: false,
    };
  }
  if ((owner === "String" || owner === "Array" || owner === "ReadonlyArray") && member === "length" &&
    hasJavaScriptLength(receiver)) {
    return { read: Object.freeze({ kind: "method", name: "js_length" }), raises: false };
  }
  if ((owner === "Map" || owner === "ReadonlyMap" || owner === "Set" || owner === "ReadonlySet") && member === "size" &&
    hasJavaScriptLength(receiver)) {
    return { read: Object.freeze({ kind: "method", name: "js_size" }), raises: false };
  }
  return undefined;
}

function hasNativeLength(type: MojoTargetTypeRef): boolean {
  return type.kind === "native-string" || type.kind === "list" || type.kind === "fixed-array" ||
    type.kind === "tuple" || type.kind === "dictionary";
}

function hasJavaScriptLength(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && [
    "tsonic.mojo.js.JsString",
    "tsonic.mojo.js.JsArray",
    "tsonic.mojo.js.JsMap",
    "tsonic.mojo.js.JsSet",
  ].includes(type.id);
}

function sourceProfileConstantName(
  profile: "native" | "js",
  owner: string,
  member: string,
): string | undefined {
  if (profile !== "js") return undefined;
  if (owner === "Math" && ["E", "LN10", "LN2", "LOG10E", "LOG2E", "PI", "SQRT1_2", "SQRT2"].includes(member)) {
    return `MATH_${member}`;
  }
  return owner === "NumberConstructor" ? numberConstantName(member) : undefined;
}

function numberConstantName(member: string): string | undefined {
  switch (member) {
    case "EPSILON": return "NUMBER_EPSILON";
    case "MAX_SAFE_INTEGER": return "NUMBER_MAX_SAFE_INTEGER";
    case "MAX_VALUE": return "NUMBER_MAX_VALUE";
    case "MIN_SAFE_INTEGER": return "NUMBER_MIN_SAFE_INTEGER";
    case "MIN_VALUE": return "NUMBER_MIN_VALUE";
    case "NaN": return "NUMBER_NAN";
    case "NEGATIVE_INFINITY": return "NUMBER_NEGATIVE_INFINITY";
    case "POSITIVE_INFINITY": return "NUMBER_POSITIVE_INFINITY";
    default: return undefined;
  }
}

function selectOperation(
  operationKind: "property" | "property-set",
  declaration: Node | undefined,
  source: ResolvedSourcePropertyAccessInfo,
  context: MojoProviderPropertyAnalysisContext,
  receiverType: MojoTargetTypeRef,
): { readonly kind: "resolved"; readonly operation: import("../../target-model/operations/selection.js").MojoSelectedProviderOperation } |
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
