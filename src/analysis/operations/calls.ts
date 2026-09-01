import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { resolveMojoNonTypeGenericArguments } from "../../policy/types/generic-arguments.js";
import { selectMojoProviderCall } from "../../policy/operations/provider-selection.js";
import { instantiateMojoProviderOperation } from "../../policy/operations/provider-instantiation.js";
import { analyzeMojoTypedLocation } from "./typed-locations.js";
import { analyzeMojoRawPointer } from "./raw-pointers.js";
import { analyzeMojoExplicitSafety } from "./explicit-safety.js";
import { analyzeMojoNativePointer } from "./native-pointers.js";
import { selectMojoSourceProfileCallRow } from "../../policy/operations/source-profile-selection.js";
import type { MojoSourceProfileParameterContract } from "../../policy/operations/source-profile-selection.js";
import { selectMojoSourceProfileCallback } from "./source-profile-callbacks.js";
import {
  mojoDynamicTargetType,
  mojoNamedTargetType,
  mojoPrimitiveTargetType,
} from "../../target-model/types/constructors.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoCallSelection,
} from "../program/model.js";
import {
  analyzeArguments,
  closeResultConversion,
  restCallableElementType,
} from "./call-arguments.js";
import {
  analyzeImplicitProjectConstruction,
  analyzeProjectCall,
  closeCanonicalProjectResult,
  locationBackedMutableArgument,
} from "./project-calls.js";

export type MojoCallAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection; readonly dependency?: Node }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoCallAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly conversions: MojoConversionIndex;
  readonly functionByDeclaration: WeakMap<Node, MojoAnalyzedFunction>;
  readonly classByDeclaration: WeakMap<Node, MojoAnalyzedClass>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly modulePathForSourceFile: (sourceFile: import("@tsonic/tsts").SourceFile) => readonly string[];
}

export function analyzeMojoCall(
  callNode: Node,
  sourceCall: ResolvedSourceCallInfo,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  const semantics = context.source.semantics.forNode(callNode);
  const resolve = (type: Type, authoredTypeNode?: Node): MojoTargetTypeRef | undefined => {
    const result = resolveMojoTargetType(type, authoredTypeNode, {
      ast: context.source.ast,
      semantics,
      sourceFacts: context.source.sourceFacts,
      providerSemantics: context.providerSemantics,
      projectTypes: context.projectTypes,
      sourceProfiles: context.sourceProfiles,
      jsEnabled: context.jsEnabled,
    });
    return result.kind === "resolved" ? result.type : undefined;
  };
  const selectedDeclaration = sourceCall.sourceCallee.selectedDeclaration ??
    sourceCall.sourceCalleeAccess?.selectedDeclaration;
  const explicitSafety = analyzeMojoExplicitSafety(
    callNode,
    sourceCall,
    context.source,
    resolve,
  );
  if (explicitSafety.kind === "unsupported") return explicitSafety;
  if (explicitSafety.kind === "resolved") {
    return { kind: "resolved", selection: explicitSafety.selection };
  }
  const nativePointer = analyzeMojoNativePointer({
    call: callNode,
    sourceCall,
    source: context.source,
    expressionTypes: context.expressionTypes,
    resolveType: resolve,
  });
  if (nativePointer.kind === "unsupported") return nativePointer;
  if (nativePointer.kind === "resolved") {
    return { kind: "resolved", selection: nativePointer.selection };
  }
  const rawPointer = analyzeMojoRawPointer({
    call: callNode,
    sourceCall,
    source: context.source,
    projectTypes: context.projectTypes,
    resolveType: resolve,
  });
  if (rawPointer.kind === "unsupported") return rawPointer;
  if (rawPointer.kind === "resolved") {
    return { kind: "resolved", selection: rawPointer.selection };
  }
  const typedLocation = analyzeMojoTypedLocation({
    call: callNode,
    sourceCall,
    source: context.source,
    expressionTypes: context.expressionTypes,
    locationStorageNames: context.locationStorageNames,
    resolveType: resolve,
  });
  if (typedLocation.kind === "unsupported") return typedLocation;
  if (typedLocation.kind === "resolved") {
    return { kind: "resolved", selection: typedLocation.selection };
  }
  const projectFunction = selectedDeclaration === undefined
    ? undefined
    : context.functionByDeclaration.get(selectedDeclaration);
  if (projectFunction !== undefined) {
    return analyzeProjectCall(sourceCall, projectFunction, resolve, context);
  }
  const directlySelectedClass = selectedDeclaration === undefined
    ? undefined
    : context.classByDeclaration.get(selectedDeclaration);
  const selectedResultCarrier = context.source.ast.is.IsNewExpression(callNode)
    ? resolve(sourceCall.sourceResultType)
    : undefined;
  const projectClass = directlySelectedClass ??
    (selectedResultCarrier?.kind === "target-named"
      ? context.classByTypeId.get(selectedResultCarrier.id)
      : undefined);
  if (projectClass !== undefined) {
    return analyzeImplicitProjectConstruction(sourceCall, projectClass, resolve);
  }

  const sourceProfile = analyzeSourceProfileCall(
    sourceCall,
    resolve,
    context,
  );
  if (sourceProfile !== undefined) return sourceProfile;

  const selectedProvider = selectMojoProviderCall(context.source, sourceCall, context.providerSemantics);
  if (selectedProvider.kind === "ambiguous") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_CALL_AMBIGUOUS",
      reason: `Selected provider call matches ${selectedProvider.count} Mojo operations.`,
    };
  }
  if (selectedProvider.kind === "missing") {
    const callableType = context.expressionTypes.get(sourceCall.sourceCallee.expression) ??
      resolve(sourceCall.sourceCallee.type, sourceCall.sourceCallee.authoredTypeNode);
    return callableType?.kind === "callable"
      ? analyzeCallableValueCall(sourceCall, callableType, resolve, context)
      : {
          kind: "unsupported",
          code: "MOJO_CALL_TARGET_UNSUPPORTED",
          reason: selectedProvider.reason,
        };
  }
  const instantiated = instantiateMojoProviderOperation(
    selectedProvider.operation,
    sourceCall,
    resolve,
    (parameter, explicitTypeNode) => resolveMojoNonTypeGenericArguments(
      parameter,
      explicitTypeNode,
      context.source.ast,
    ),
  );
  if (instantiated.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_PROVIDER_CALL_NOT_CLOSED", reason: instantiated.reason };
  }
  const target = instantiated.operation.target;
  if (target.kind !== "function-call" && target.kind !== "instance-call") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_CALL_FORM_INVALID",
      reason: `Selected provider call maps to non-call target form '${target.kind}'.`,
    };
  }
  const arguments_ = analyzeArguments(
    sourceCall,
    instantiated.operation.parameterTypes,
    target.arguments,
    resolve,
    context.expressionTypes,
    undefined,
    (expression) => context.source.ast.is.IsObjectLiteralExpression(expression),
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const locationConflict = locationBackedMutableArgument(
    arguments_.arguments,
    target.arguments,
    context,
  );
  if (locationConflict !== undefined) return locationConflict;
  const result = closeResultConversion(
    instantiated.operation.resultType,
    sourceCall.sourceResultType,
    resolve,
  );
  if (result.kind === "unsupported") return result;
  let receiverConversion;
  let sourceReceiverType;
  if (instantiated.operation.receiverType !== undefined) {
    const receiver = sourceCall.sourceReceiver;
    const actual = receiver === undefined
      ? undefined
      : resolve(
          receiver.type,
          receiver.authoredTypeNode ?? (receiver.declaration === undefined
            ? undefined
            : context.source.ast.typeNode(receiver.declaration)),
        );
    if (receiver === undefined || actual === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROVIDER_RECEIVER_NOT_CLOSED",
        reason: "Selected provider operation requires a receiver whose exact Mojo carrier is unavailable.",
      };
    }
    const conversion = classifyMojoValueConversion(actual, instantiated.operation.receiverType);
    if (conversion.kind === "unsupported") {
      return { kind: "unsupported", code: "MOJO_PROVIDER_RECEIVER_CONVERSION_UNPROVEN", reason: conversion.reason };
    }
    receiverConversion = conversion.conversion;
    sourceReceiverType = actual;
  }
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "provider",
      operation: instantiated.operation,
      arguments: arguments_.arguments,
      ...(sourceReceiverType === undefined
        ? {}
        : { receiver: sourceCall.sourceReceiver!.expression }),
      ...(sourceReceiverType === undefined ? {} : { sourceReceiverType }),
      ...(receiverConversion === undefined ? {} : { receiverConversion }),
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function analyzeSourceProfileCall(
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis | undefined {
  const selected = selectMojoSourceProfileCallRow(
    context.source,
    sourceCall,
    context.sourceProfiles,
  );
  if (selected.kind === "not-source-profile") return undefined;
  if (selected.kind === "unsupported") return selected;
  if (sourceCall.sourceSelectedSignatureKind !== "resolved") {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_SIGNATURE_NOT_RESOLVED",
      reason: "A source-profile call requires one exact resolved source signature.",
    };
  }
  const parameterTypes: MojoTargetTypeRef[] = [];
  const targetArguments: {
    readonly convention: "imm";
    readonly position: "positional-or-keyword";
    readonly variadic: boolean;
    readonly passing: "plain";
  }[] = [];
  const parameterContract = selected.row.parameterContract;
  const callback = selected.row.callback === undefined
    ? undefined
    : selectMojoSourceProfileCallback(
        selected.row.callback,
        sourceCall,
        resolve,
        context.expressionTypes,
      );
  if (callback?.kind === "unsupported") return callback;
  if (parameterContract !== undefined) {
    if (parameterContract.length > sourceCall.sourceSelectedSignatureParameters.length ||
      sourceCall.sourceArgumentBindings.some((binding) =>
        binding.sourceParameterIndex >= parameterContract.length)) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_PARAMETER_CONTRACT_INVALID",
        reason: `The exact source-profile overload '${selected.row.owner}.${selected.row.member}' cannot be represented by its Mojo runtime parameter contract.`,
      };
    }
  }
  const selectedParameters = parameterContract === undefined
    ? sourceCall.sourceSelectedSignatureParameters
    : sourceCall.sourceSelectedSignatureParameters.slice(0, parameterContract.length);
  for (const [parameterIndex, parameter] of selectedParameters.entries()) {
    const explicitContract = parameterContract?.[parameterIndex];
    const resolved = callback?.parameterIndex === parameterIndex
      ? callback.type
      : explicitContract === undefined
        ? resolve(parameter.selectedType, parameter.authoredTypeNode)
        : sourceProfileParameterType(explicitContract);
    const target = parameter.rest === true && resolved !== undefined
      ? restCallableElementType(resolved)
      : resolved;
    if (target === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_PARAMETER_NOT_CLOSED",
        reason: `Source-profile parameter ${parameter.parameterIndex} has no exact Mojo carrier.`,
      };
    }
    parameterTypes.push(target);
    targetArguments.push(Object.freeze({
      convention: "imm",
      position: "positional-or-keyword",
      variadic: parameter.rest,
      passing: "plain",
    }));
  }
  const arguments_ = analyzeArguments(
    sourceCall,
    parameterTypes,
    targetArguments,
    resolve,
    context.expressionTypes,
    callback?.conversion === undefined
      ? undefined
      : new Map([[callback.parameterIndex, callback.conversion]]),
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const resultType = resolve(sourceCall.sourceResultType);
  if (resultType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_RESULT_NOT_CLOSED",
      reason: "The selected source-profile call result has no exact Mojo carrier.",
    };
  }
  const result = closeResultConversion(
    resultType,
    sourceCall.sourceResultType,
    resolve,
  );
  if (result.kind === "unsupported") return result;
  const genericArguments: MojoTargetGenericArgument[] = [];
  for (const selectedArgument of sourceCall.sourceSelectedMethodTypeArguments ?? []) {
    const argument = resolve(selectedArgument.selectedType, selectedArgument.explicitTypeNode);
    if (argument === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_TYPE_ARGUMENT_NOT_CLOSED",
        reason: `Selected source-profile type argument '${selectedArgument.typeParameterName}' has no exact Mojo carrier.`,
      };
    }
    genericArguments.push(Object.freeze({ kind: "type", type: argument }));
  }
  const target = selected.row.target.kind === "instance"
    ? Object.freeze({
        kind: "instance-call" as const,
        name: callback?.targetName ?? selected.row.target.name,
        receiver: selected.row.target.receiver,
        genericParameters: Object.freeze([]),
        arguments: Object.freeze(targetArguments),
      })
    : Object.freeze({
        kind: "function-call" as const,
        modulePath: selected.row.target.modulePath,
        name: callback?.targetName ?? selected.row.target.name,
        ...(selected.row.target.receiver === undefined
          ? {}
          : { receiver: selected.row.target.receiver }),
        genericParameters: Object.freeze([]),
        arguments: Object.freeze(targetArguments),
      });
  let receiver: Node | undefined;
  let sourceReceiverType: MojoTargetTypeRef | undefined;
  let receiverConversion;
  if (selected.row.target.kind === "instance" || selected.row.target.receiver !== undefined) {
    const sourceReceiver = sourceCall.sourceReceiver;
    sourceReceiverType = sourceReceiver === undefined
      ? undefined
      : resolve(
          sourceReceiver.type,
          sourceReceiver.authoredTypeNode ?? (sourceReceiver.declaration === undefined
            ? undefined
            : context.source.ast.typeNode(sourceReceiver.declaration)),
        );
    if (sourceReceiver === undefined || sourceReceiverType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_RECEIVER_NOT_CLOSED",
        reason: "The selected source-profile instance call has no exact receiver carrier.",
      };
    }
    if (selected.row.receiverCapability === "integer" &&
      !isExactMojoIntegerCarrier(sourceReceiverType)) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_RECEIVER_CAPABILITY_UNPROVEN",
        reason: `The exact source-profile call '${selected.row.owner}.${selected.row.member}' requires an integral receiver carrier.`,
      };
    }
    receiver = sourceReceiver.expression;
    const conversion = classifyMojoValueConversion(sourceReceiverType, sourceReceiverType);
    if (conversion.kind === "unsupported") return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_RECEIVER_CONVERSION_UNPROVEN",
      reason: conversion.reason,
    };
    receiverConversion = conversion.conversion;
  }
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "provider",
      operation: Object.freeze({
        target,
        ...(sourceReceiverType === undefined ? {} : { receiverType: sourceReceiverType }),
        parameterTypes: Object.freeze(parameterTypes),
        resultType,
        genericArguments: Object.freeze(genericArguments),
        genericParameters: Object.freeze([]),
        raises: selected.row.raises === true || callback !== undefined,
      }),
      arguments: arguments_.arguments,
      ...(receiver === undefined ? {} : { receiver }),
      ...(sourceReceiverType === undefined ? {} : { sourceReceiverType }),
      ...(receiverConversion === undefined ? {} : { receiverConversion }),
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function isExactMojoIntegerCarrier(type: MojoTargetTypeRef): boolean {
  if (type.kind !== "source-primitive") return false;
  switch (type.name) {
    case "int8":
    case "uint8":
    case "int16":
    case "uint16":
    case "int32":
    case "uint32":
    case "int64":
    case "uint64":
    case "native-int":
    case "native-uint":
      return true;
    case "bool":
    case "char":
    case "float16":
    case "float32":
    case "float64":
    case "int128":
    case "uint128":
    case "decimal":
      return false;
  }
}

function sourceProfileParameterType(
  contract: MojoSourceProfileParameterContract,
): MojoTargetTypeRef {
  switch (contract) {
    case "float64":
      return mojoPrimitiveTargetType("float64");
    case "js-string":
      return mojoNamedTargetType(
        "tsonic.mojo.js.JsString",
        ["tsonic_js"],
        "JsString",
      );
    case "js-value":
      return mojoDynamicTargetType("js");
  }
}

function analyzeCallableValueCall(
  sourceCall: ResolvedSourceCallInfo,
  callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  const sourceParameters = sourceCall.sourceSelectedSignatureParameters;
  if (sourceParameters.length !== callableType.parameters.length) {
    return {
      kind: "unsupported",
      code: "MOJO_CALLABLE_VALUE_ABI_MISMATCH",
      reason: "The selected source callable signature and sealed Mojo function carrier have different arities.",
    };
  }
  const parameterTypes = callableType.parameters.map((parameter, index) => {
    const selected = sourceParameters[index];
    return selected?.rest === true ? restCallableElementType(parameter.type) : parameter.type;
  });
  if (parameterTypes.some((parameter) => parameter === undefined)) {
    return {
      kind: "unsupported",
      code: "MOJO_CALLABLE_VALUE_REST_CARRIER_UNSUPPORTED",
      reason: "A variadic callable value requires one exact list element carrier.",
    };
  }
  const arguments_ = analyzeArguments(
    sourceCall,
    parameterTypes as readonly MojoTargetTypeRef[],
    callableType.parameters.map((parameter, index) => Object.freeze({
      convention: parameter.convention,
      position: "positional-or-keyword" as const,
      variadic: sourceParameters[index]!.rest,
      passing: parameter.passing,
    })),
    resolve,
    context.expressionTypes,
    undefined,
    (expression) => context.source.ast.is.IsObjectLiteralExpression(expression),
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const callableTargets = callableType.parameters.map((parameter) => Object.freeze({
    convention: parameter.convention,
  }));
  const locationConflict = locationBackedMutableArgument(
    arguments_.arguments,
    callableTargets,
    context,
  );
  if (locationConflict !== undefined) return locationConflict;
  const targetResult = callableType.result;
  const result = closeCanonicalProjectResult(targetResult);
  if (result.kind === "unsupported") return result;
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "callable",
      callee: sourceCall.sourceCallee.expression,
      callableType,
      arguments: arguments_.arguments,
      resultType: targetResult,
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}
