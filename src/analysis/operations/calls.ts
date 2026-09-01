import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import { substituteMojoTargetType } from "../../target-model/provider/substitution.js";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoProjectTypeCatalog } from "../types/project-catalog.js";
import type { MojoSourceProfileRegistry } from "../types/source-profile.js";
import { resolveMojoTargetType } from "../types/resolution.js";
import type { MojoConversionIndex } from "../conversions/classification.js";
import { classifyMojoValueConversion } from "../conversions/classification.js";
import { selectMojoProviderCall } from "./provider-selection.js";
import { instantiateMojoProviderOperation } from "./provider-instantiation.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedCallArgument,
  MojoAnalyzedFunction,
  MojoCallSelection,
} from "../program/model.js";

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
  const projectFunction = selectedDeclaration === undefined
    ? undefined
    : context.functionByDeclaration.get(selectedDeclaration);
  if (projectFunction !== undefined) {
    return analyzeProjectCall(callNode, sourceCall, projectFunction, resolve, context);
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
    return analyzeImplicitProjectConstruction(callNode, sourceCall, projectClass, resolve, context);
  }

  const selectedProvider = selectMojoProviderCall(context.source, sourceCall, context.providerSemantics);
  if (selectedProvider.kind !== "selected") {
    return {
      kind: "unsupported",
      code: selectedProvider.kind === "ambiguous"
        ? "MOJO_PROVIDER_CALL_AMBIGUOUS"
        : "MOJO_CALL_TARGET_UNSUPPORTED",
      reason: selectedProvider.kind === "ambiguous"
        ? `Selected provider call matches ${selectedProvider.count} Mojo operations.`
        : selectedProvider.reason,
    };
  }
  const instantiated = instantiateMojoProviderOperation(selectedProvider.operation, sourceCall, resolve);
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
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const result = closeResultConversion(
    callNode,
    instantiated.operation.resultType,
    sourceCall.sourceResultType,
    resolve,
    context.conversions,
  );
  if (result.kind === "unsupported") return result;
  let receiverConversion;
  let sourceReceiverType;
  if (instantiated.operation.receiverType !== undefined) {
    const receiver = sourceCall.sourceReceiver;
    const actual = receiver === undefined ? undefined : resolve(receiver.type);
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
      ...(sourceCall.sourceReceiver === undefined ? {} : { receiver: sourceCall.sourceReceiver.expression }),
      ...(sourceReceiverType === undefined ? {} : { sourceReceiverType }),
      ...(receiverConversion === undefined ? {} : { receiverConversion }),
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function analyzeProjectCall(
  callNode: Node,
  sourceCall: ResolvedSourceCallInfo,
  function_: MojoAnalyzedFunction,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const genericArguments: MojoTargetGenericArgument[] = [];
  for (const parameter of function_.typeParameters) {
    const selected = (sourceCall.sourceSelectedMethodTypeArguments ?? [])
      .filter((argument) => argument.typeParameterName === parameter.name);
    if (selected.length !== 1) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_CALL_TYPE_ARGUMENT_NOT_CLOSED",
        reason: `Selected project call type parameter '${parameter.name}' has ${selected.length} exact arguments.`,
      };
    }
    const targetType = resolve(
      selected[0]!.selectedType,
      selected[0]!.explicitTypeNode,
    );
    if (targetType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_CALL_TYPE_ARGUMENT_NOT_CLOSED",
        reason: `Selected project call type argument '${parameter.name}' has no Mojo carrier.`,
      };
    }
    typeSubstitutions.set(parameter.name, targetType);
    genericArguments.push(Object.freeze({ kind: "type", type: targetType }));
  }
  const substitutions = { types: typeSubstitutions, constants: new Map() };
  const parameterTypes = function_.parameters.map((parameter) =>
    substituteMojoTargetType(parameter.type, substitutions));
  const targetArguments = function_.parameters.map((parameter) => Object.freeze({
    convention: parameter.convention,
    position: "positional-or-keyword" as const,
    variadic: parameter.rest,
    passing: parameter.passing,
  }));
  const arguments_ = analyzeArguments(
    sourceCall,
    parameterTypes,
    targetArguments,
    resolve,
    context.expressionTypes,
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const targetOutput = substituteMojoTargetType(function_.resultType, substitutions);
  const targetResult = function_.asynchronous
    ? Object.freeze({
        kind: "future" as const,
        domain: function_.asyncDomain ?? "native",
        output: targetOutput,
      })
    : targetOutput;
  const callResult = function_.kind === "constructor"
    ? function_.owner?.type
    : targetResult;
  if (callResult === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_CONSTRUCTOR_OWNER_MISSING",
      reason: "Project constructor has no exact owning class carrier.",
    };
  }
  const result = closeCanonicalProjectResult(callNode, callResult, context.conversions);
  if (result.kind === "unsupported") return result;
  const target = projectCallTarget(function_, sourceCall, callResult, context);
  if (target.kind === "unsupported") return target;
  return {
    kind: "resolved",
    dependency: function_.declaration,
    selection: Object.freeze({
      kind: "project",
      target: target.target,
      genericArguments: Object.freeze(genericArguments),
      arguments: arguments_.arguments,
      resultType: callResult,
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function projectCallTarget(
  function_: MojoAnalyzedFunction,
  sourceCall: ResolvedSourceCallInfo,
  resultType: MojoTargetTypeRef,
  context: MojoCallAnalysisContext,
): { readonly kind: "resolved"; readonly target: Extract<MojoCallSelection, { kind: "project" }>["target"] } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  if (function_.kind === "constructor") {
    return { kind: "resolved", target: Object.freeze({ kind: "constructor", type: resultType }) };
  }
  if (function_.kind === "function") {
    return {
      kind: "resolved",
      target: Object.freeze({
        kind: "function",
        name: function_.name,
        modulePath: Object.freeze([...context.modulePathForSourceFile(function_.sourceFile)]),
      }),
    };
  }
  if (function_.static === true) {
    if (function_.owner === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_STATIC_METHOD_OWNER_MISSING",
        reason: "Static project method has no exact owning class carrier.",
      };
    }
    return {
      kind: "resolved",
      target: Object.freeze({ kind: "static-method", owner: function_.owner.type, name: function_.name }),
    };
  }
  const receiver = sourceCall.sourceReceiver?.expression;
  if (receiver === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_METHOD_RECEIVER_MISSING",
      reason: "Selected project instance method has no exact source receiver.",
    };
  }
  return {
    kind: "resolved",
    target: Object.freeze({
      kind: "method",
      name: function_.name,
      receiver,
      receiverType: function_.owner!.type,
    }),
  };
}

function analyzeImplicitProjectConstruction(
  callNode: Node,
  sourceCall: ResolvedSourceCallInfo,
  class_: MojoAnalyzedClass,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  if (class_.constructors.length !== 0 || sourceCall.sourceArguments.length !== 0) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_CONSTRUCTOR_SELECTION_UNRESOLVED",
      reason: "An implicit project constructor requires an exact zero-argument source signature.",
    };
  }
  const sourceResult = resolve(sourceCall.sourceResultType);
  if (sourceResult === undefined || sourceResult.kind !== "target-named" ||
    class_.targetType.kind !== "target-named" || sourceResult.id !== class_.targetType.id) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_CONSTRUCTOR_RESULT_NOT_CLOSED",
      reason: "Implicit project construction has no exact closed class result carrier.",
    };
  }
  const result = closeCanonicalProjectResult(callNode, sourceResult, context.conversions);
  if (result.kind === "unsupported") return result;
  return {
    kind: "resolved",
    dependency: class_.declaration,
    selection: Object.freeze({
      kind: "project",
      target: Object.freeze({ kind: "constructor", type: sourceResult }),
      genericArguments: Object.freeze([]),
      arguments: Object.freeze([]),
      resultType: sourceResult,
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function analyzeArguments(
  sourceCall: ResolvedSourceCallInfo,
  parameterTypes: readonly MojoTargetTypeRef[],
  targetArguments: readonly {
    readonly convention: "imm" | "mut" | "var" | "ref" | "out" | "deinit";
    readonly position: "positional" | "positional-or-keyword" | "keyword";
    readonly nativeName?: string;
    readonly variadic?: boolean;
    readonly passing?: "plain" | "consume";
  }[],
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): { readonly kind: "resolved"; readonly arguments: readonly MojoAnalyzedCallArgument[] } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  if (parameterTypes.length !== targetArguments.length) {
    return {
      kind: "unsupported",
      code: "MOJO_CALL_ABI_MISMATCH",
      reason: "Selected call parameter carriers and target argument ABI have different arities.",
    };
  }
  const arguments_: MojoAnalyzedCallArgument[] = [];
  for (const [sourceArgumentIndex, sourceArgument] of sourceCall.sourceArguments.entries()) {
    const bindings = sourceCall.sourceArgumentBindings.filter((binding) =>
      binding.sourceArgumentIndex === sourceArgumentIndex);
    if (bindings.length === 0) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_BINDING_MISSING",
        reason: `Source call argument ${sourceArgumentIndex} has no exact selected parameter binding.`,
      };
    }
    const parameterIndex = bindings[0]!.sourceParameterIndex;
    if (bindings.some((binding) => binding.sourceParameterIndex !== parameterIndex)) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_EXPANSION_UNSUPPORTED",
        reason: `Source call argument ${sourceArgumentIndex} expands across multiple target parameters.`,
      };
    }
    const parameterType = parameterTypes[parameterIndex];
    const target = targetArguments[parameterIndex];
    const sourceType = expressionTypes.get(sourceArgument.expression) ??
      resolve(bindings[0]!.selectedArgumentType);
    if (parameterType === undefined || target === undefined || sourceType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_CARRIER_NOT_CLOSED",
        reason: `Source call argument ${sourceArgumentIndex} has no closed Mojo argument contract.`,
      };
    }
    const spread = bindings.some((binding) => binding.sourceForm !== "value");
    if (spread && target.variadic !== true) {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_SPREAD_UNSUPPORTED",
        reason: `Source call argument ${sourceArgumentIndex} spreads into a non-variadic Mojo parameter.`,
      };
    }
    const conversion = classifyMojoValueConversion(sourceType, parameterType);
    if (conversion.kind === "unsupported") {
      return {
        kind: "unsupported",
        code: "MOJO_CALL_ARGUMENT_CONVERSION_UNPROVEN",
        reason: conversion.reason,
      };
    }
    arguments_.push(Object.freeze({
      expression: sourceArgument.expression,
      sourceType,
      parameterType,
      conversion: conversion.conversion,
      passing: target.passing ??
        (target.convention === "var" || target.convention === "deinit" ? "consume" : "plain"),
      spread,
      position: target.position,
      ...(target.position === "keyword" && target.nativeName !== undefined
        ? { nativeName: target.nativeName }
        : {}),
    }));
  }
  return { kind: "resolved", arguments: Object.freeze(arguments_) };
}

function closeResultConversion(
  callNode: Node,
  targetResult: MojoTargetTypeRef,
  sourceResult: Type,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  conversions: MojoConversionIndex,
): { readonly kind: "resolved"; readonly conversion: import("../program/model.js").MojoValueConversion } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const sourceCarrier = resolve(sourceResult);
  if (sourceCarrier === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_CALL_RESULT_CARRIER_NOT_CLOSED",
      reason: "Selected source call result has no closed Mojo carrier.",
    };
  }
  const conversion = conversions.record(callNode, targetResult, sourceCarrier);
  return conversion.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_CALL_RESULT_CONVERSION_UNPROVEN", reason: conversion.reason }
    : { kind: "resolved", conversion: conversion.conversion };
}

function closeCanonicalProjectResult(
  callNode: Node,
  targetResult: MojoTargetTypeRef,
  conversions: MojoConversionIndex,
): { readonly kind: "resolved"; readonly conversion: import("../program/model.js").MojoValueConversion } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const conversion = conversions.record(callNode, targetResult, targetResult);
  return conversion.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_PROJECT_CALL_RESULT_CONFLICT", reason: conversion.reason }
    : { kind: "resolved", conversion: conversion.conversion };
}
