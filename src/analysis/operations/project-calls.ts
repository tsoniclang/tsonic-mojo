import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/types/model.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type {
  MojoAnalyzedCallArgument,
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoCallSelection,
} from "../program/model.js";
import { analyzeArguments } from "./call-arguments.js";
import type { MojoCallAnalysis, MojoCallAnalysisContext } from "./calls.js";

export function analyzeProjectCall(
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
  const substitutions = { types: typeSubstitutions, values: new Map(), packs: new Map() };
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
    undefined,
    (expression) => context.source.ast.is.IsObjectLiteralExpression(expression),
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const locationConflict = locationBackedMutableArgument(
    arguments_.arguments,
    targetArguments,
    context,
  );
  if (locationConflict !== undefined) return locationConflict;
  const targetOutput = substituteMojoTargetType(function_.resultType, substitutions);
  const targetResult = function_.asynchronous
    ? Object.freeze({
        kind: "future" as const,
        domain: function_.asyncDomain ?? "native",
        output: targetOutput,
        raises: function_.raises,
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
  const result = closeCanonicalProjectResult(callResult);
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

export function analyzeImplicitProjectConstruction(
  sourceCall: ResolvedSourceCallInfo,
  class_: MojoAnalyzedClass,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
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
  const result = closeCanonicalProjectResult(sourceResult);
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

export function locationBackedMutableArgument(
  arguments_: readonly MojoAnalyzedCallArgument[],
  targets: readonly { readonly convention: string }[],
  context: MojoCallAnalysisContext,
): MojoCallAnalysis | undefined {
  for (const [index, argument] of arguments_.entries()) {
    const convention = targets[index]?.convention;
    if (convention === undefined || convention === "imm" || convention === "var" ||
      convention === "deinit") continue;
    const reference = context.source.navigation.sourceReferenceFor(argument.expression);
    if (reference?.project !== true ||
      context.locationStorageNames.get(reference.declaration) === undefined) continue;
    return {
      kind: "unsupported",
      code: "MOJO_LOCATION_MUTABLE_ARGUMENT_NATIVE_LIMIT",
      reason: `A promoted typed-location storage cannot be passed through Mojo '${convention}' without an exact borrow projection.`,
    };
  }
  return undefined;
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

export function closeCanonicalProjectResult(
  targetResult: MojoTargetTypeRef,
): { readonly kind: "resolved"; readonly conversion: MojoValueConversion } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const conversion = classifyMojoValueConversion(targetResult, targetResult);
  return conversion.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_PROJECT_CALL_RESULT_CONFLICT", reason: conversion.reason }
    : { kind: "resolved", conversion: conversion.conversion };
}
