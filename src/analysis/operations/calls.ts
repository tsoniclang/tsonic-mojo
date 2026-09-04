import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import { resolveMojoNonTypeGenericArguments } from "../../policy/types/generic-arguments.js";
import { selectMojoProviderCall } from "../../policy/operations/provider-selection.js";
import { instantiateMojoProviderOperation } from "../../policy/operations/provider-instantiation.js";
import { analyzeMojoTypedLocation } from "./typed-locations.js";
import { analyzeMojoRawPointer } from "./raw-pointers.js";
import { analyzeMojoExplicitSafety } from "./explicit-safety.js";
import { analyzeMojoNativePointer } from "./native-pointers.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedProjectCallable,
  MojoCallSelection,
} from "../program/model.js";
import {
  analyzeArguments,
  analyzeMojoArgumentDisposition,
  closeResultConversion,
  restCallableElementType,
} from "./call-arguments.js";
import {
  analyzeImplicitProjectConstruction,
  analyzeProjectCall,
  closeCanonicalProjectResult,
  closeLocationBackedArguments,
} from "./project-calls.js";
import { analyzeSourceProfileCall } from "./source-profile-calls.js";
import { analyzeMojoSourceIntrinsic } from "./source-intrinsics.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";
import type { MojoValueOwnership } from "../../target-model/lifecycle/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";

export type MojoCallAnalysis =
  | { readonly kind: "resolved"; readonly selection: MojoCallSelection; readonly dependency?: Node }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export interface MojoCallAnalysisContext {
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleResolver;
  readonly valueOwnership: (expression: Node) => MojoValueOwnership;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly valueRefinements: WeakMap<Node, import("../program/model.js").MojoValueRefinementSelection>;
  readonly conversions: MojoConversionIndex;
  readonly callableByDeclaration: WeakMap<Node, MojoAnalyzedProjectCallable>;
  readonly classByDeclaration: WeakMap<Node, MojoAnalyzedClass>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly modulePathForSourceFile: (sourceFile: import("@tsonic/tsts").SourceFile) => readonly string[];
  readonly contextualizeCallableArgument: (
    expression: Node,
    targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  ) => Extract<MojoTargetTypeRef, { readonly kind: "callable" }> | undefined;
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
      navigation: context.source.navigation,
      semantics,
      sourceFacts: context.source.sourceFacts,
      providerSemantics: context.providerSemantics,
      projectTypes: context.projectTypes,
      sourceProfiles: context.sourceProfiles,
      jsEnabled: context.jsEnabled,
      ...(context.sourceCallableErrorType === undefined
        ? {}
        : { sourceCallableErrorType: context.sourceCallableErrorType }),
    });
    return result.kind === "resolved" ? result.type : undefined;
  };
  const selectedDeclaration = sourceCall.sourceCallee.selectedDeclaration ??
    sourceCall.sourceCalleeAccess?.selectedDeclaration;
  const selectedSignatureDeclaration = semantics.declarations.signatureDeclaration(
    sourceCall.selectedSignature,
  );
  const sourceIntrinsic = analyzeMojoSourceIntrinsic({
    call: callNode,
    sourceCall,
    source: context.source,
    lifecycle: context.lifecycle,
    expressionTypes: context.expressionTypes,
    resolveType: resolve,
  });
  if (sourceIntrinsic.kind === "unsupported") return sourceIntrinsic;
  if (sourceIntrinsic.kind === "resolved") {
    return { kind: "resolved", selection: sourceIntrinsic.selection };
  }
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
  const projectCallable = selectedSignatureDeclaration === undefined
    ? undefined
    : context.callableByDeclaration.get(selectedSignatureDeclaration);
  if (projectCallable !== undefined) {
    const callableType = context.expressionTypes.get(sourceCall.sourceCallee.expression) ??
      resolve(sourceCall.sourceCallee.type, sourceCall.sourceCallee.authoredTypeNode);
    if (projectCallable.contract.kind === "method" &&
      sourceCall.sourceReceiver === undefined && callableType?.kind === "callable") {
      return analyzeCallableValueCall(sourceCall, callableType, resolve, context);
    }
    return analyzeProjectCall(sourceCall, projectCallable, resolve, context);
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
      {
        ast: context.source.ast,
        navigation: context.source.navigation,
        semantics,
        sourceFacts: context.source.sourceFacts,
        providerSemantics: context.providerSemantics,
        projectTypes: context.projectTypes,
        sourceProfiles: context.sourceProfiles,
        jsEnabled: context.jsEnabled,
        ...(context.sourceCallableErrorType === undefined
          ? {}
          : { sourceCallableErrorType: context.sourceCallableErrorType }),
      },
    ),
  );
  if (instantiated.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_PROVIDER_CALL_NOT_CLOSED", reason: instantiated.reason };
  }
  const target = instantiated.operation.target;
  if (target.kind === "unsupported") {
    return {
      kind: "unsupported",
      code: target.code,
      reason: target.reason,
    };
  }
  if (target.kind !== "function-call" && target.kind !== "instance-call") {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_CALL_FORM_INVALID",
      reason: `Selected provider call maps to non-call target form '${target.kind}'.`,
    };
  }
  const arguments_ = analyzeArguments(
    context.source.ast,
    sourceCall,
    instantiated.operation.parameterTypes,
    target.arguments,
    resolve,
    context.expressionTypes,
    context.valueRefinements,
    context.lifecycle,
    context.valueOwnership,
    undefined,
    (expression) => context.source.ast.is.IsObjectLiteralExpression(expression),
    context.projectRelationships,
    context.contextualizeCallableArgument,
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const closedArguments = closeLocationBackedArguments(
    arguments_.arguments,
    target.arguments,
    context,
  );
  if (closedArguments.kind === "unsupported") return closedArguments;
  const result = closeResultConversion(
    instantiated.operation.resultType,
    sourceCall.sourceResultType,
    resolve,
    context.projectRelationships,
  );
  if (result.kind === "unsupported") return result;
  let receiverConversion;
  let receiverDisposition;
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
    const conversion = classifyMojoRefinedValueConversion(
      actual,
      instantiated.operation.receiverType,
      context.valueRefinements.get(receiver.expression),
      context.projectRelationships,
    );
    if (conversion.kind === "unsupported") {
      return { kind: "unsupported", code: "MOJO_PROVIDER_RECEIVER_CONVERSION_UNPROVEN", reason: conversion.reason };
    }
    receiverConversion = conversion.conversion;
    sourceReceiverType = actual;
    const disposition = analyzeMojoArgumentDisposition(
      receiver.expression,
      instantiated.operation.receiverType,
      Object.freeze({
        convention: target.receiver ?? "imm",
        position: "positional-or-keyword",
      }),
      conversion.conversion,
      context.lifecycle,
      context.valueOwnership,
    );
    if (disposition.kind === "unsupported") return disposition;
    receiverDisposition = disposition.disposition;
  }
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "provider",
      operation: instantiated.operation,
      arguments: closedArguments.arguments,
      ...(sourceReceiverType === undefined
        ? {}
        : { receiver: sourceCall.sourceReceiver!.expression }),
      ...(sourceReceiverType === undefined ? {} : { sourceReceiverType }),
      ...(receiverConversion === undefined ? {} : { receiverConversion }),
      ...(receiverDisposition === undefined ? {} : { receiverDisposition }),
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
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
  for (const [index, parameter] of callableType.parameters.entries()) {
    const sourceOmission = sourceParameterOmissionForm(sourceParameters[index]!);
    const targetOmission = parameter.omissionKind === "rest"
      ? "rest"
      : parameter.omissionKind === undefined || parameter.omissionKind === "required"
        ? "required"
        : "optional";
    if (targetOmission !== sourceOmission) {
      return {
        kind: "unsupported",
        code: "MOJO_CALLABLE_VALUE_OMISSION_ABI_MISMATCH",
        reason: "The selected source callable omission contract differs from the sealed Mojo callable ABI.",
      };
    }
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
    context.source.ast,
    sourceCall,
    parameterTypes as readonly MojoTargetTypeRef[],
    callableType.parameters.map((parameter, index) => Object.freeze({
      convention: parameter.convention,
      position: "positional-or-keyword" as const,
      variadic: sourceParameters[index]!.rest,
      ...(sourceParameters[index]!.rest ? { variadicCollectionType: parameter.type } : {}),
      passing: parameter.passing,
    })),
    resolve,
    context.expressionTypes,
    context.valueRefinements,
    context.lifecycle,
    context.valueOwnership,
    undefined,
    (expression) => context.source.ast.is.IsObjectLiteralExpression(expression),
    context.projectRelationships,
    context.contextualizeCallableArgument,
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const callableTargets = callableType.parameters.map((parameter) => Object.freeze({
    convention: parameter.convention,
  }));
  const closedArguments = closeLocationBackedArguments(
    arguments_.arguments,
    callableTargets,
    context,
  );
  if (closedArguments.kind === "unsupported") return closedArguments;
  const argumentSlots = callableType.parameters.map((parameter, parameterIndex) => {
    const selected = sourceParameters[parameterIndex]!;
    const bound = closedArguments.arguments.filter((argument) =>
      argument.parameterIndex === parameterIndex);
    if (selected.rest) {
      const elementType = parameterTypes[parameterIndex]!;
      return Object.freeze({
        kind: "rest" as const,
        type: parameter.type,
        elementType,
        arguments: Object.freeze(bound),
      });
    }
    if (bound.length === 1) {
      return Object.freeze({ kind: "value" as const, argument: bound[0]! });
    }
    if (bound.length === 0 && sourceParameterOmissionForm(selected) !== "required") {
      return Object.freeze({ kind: "optional-absent" as const, type: parameter.type });
    }
    return undefined;
  });
  if (argumentSlots.some((slot) => slot === undefined)) {
    return {
      kind: "unsupported",
      code: "MOJO_CALLABLE_VALUE_ARGUMENT_SLOT_UNCLOSED",
      reason: "The selected callable arguments do not close exactly over required, optional, and rest slots.",
    };
  }
  const targetResult = callableType.result;
  const result = closeCanonicalProjectResult(targetResult);
  if (result.kind === "unsupported") return result;
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "callable",
      callee: sourceCall.sourceCallee.expression,
      callableType,
      arguments: closedArguments.arguments,
      argumentSlots: Object.freeze(argumentSlots as NonNullable<(typeof argumentSlots)[number]>[]),
      resultType: targetResult,
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function sourceParameterOmissionForm(
  parameter: ResolvedSourceCallInfo["sourceSelectedSignatureParameters"][number],
): "required" | "optional" | "rest" {
  return parameter.rest ? "rest" : parameter.acceptsOmission ? "optional" : "required";
}
