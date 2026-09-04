import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/types/model.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type {
  MojoAnalyzedCallArgument,
  MojoAnalyzedClass,
  MojoAnalyzedProjectCallable,
  MojoCallSelection,
} from "../program/model.js";
import { analyzeArguments } from "./call-arguments.js";
import type { MojoCallAnalysis, MojoCallAnalysisContext } from "./calls.js";
import {
  mojoParameterArgumentDisposition,
  mojoParameterConvention,
} from "../representations/index.js";
import { resolveMojoValueGenericArgument } from "../../policy/types/generic-arguments.js";
import { resolveMojoSourceOrigin } from "../../policy/types/origins.js";

export function analyzeProjectCall(
  sourceCall: ResolvedSourceCallInfo,
  callable: MojoAnalyzedProjectCallable,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis {
  const contract = callable.contract;
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const valueSubstitutions = new Map<string, MojoTargetGenericArgument>();
  const originSubstitutions = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  const genericArguments: MojoTargetGenericArgument[] = [];
  for (const parameter of contract.typeParameters) {
    const selected = (sourceCall.sourceSelectedMethodTypeArguments ?? [])
      .filter((argument) => argument.typeParameterName === parameter.name);
    if (selected.length !== 1) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_CALL_TYPE_ARGUMENT_NOT_CLOSED",
        reason: `Selected project call type parameter '${parameter.name}' has ${selected.length} exact arguments.`,
      };
    }
    const argument = projectGenericArgument(parameter, selected[0]!, resolve, context, contract);
    if (argument === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_CALL_TYPE_ARGUMENT_NOT_CLOSED",
        reason: `Selected project call type argument '${parameter.name}' has no Mojo carrier.`,
      };
    }
    if (parameter.kind === "type" && argument.kind === "type") {
      typeSubstitutions.set(parameter.name, argument.type);
      typeSubstitutions.set(parameter.identity, argument.type);
    } else if (parameter.kind === "origin" && argument.kind === "origin") {
      originSubstitutions.set(parameter.name, argument.origin);
    } else if (parameter.kind === "value" && argument.kind !== "type" && argument.kind !== "origin") {
      valueSubstitutions.set(parameter.name, argument);
    } else {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_CALL_TYPE_ARGUMENT_KIND_CONFLICT",
        reason: `Selected project call argument '${parameter.name}' conflicts with its exact ${parameter.kind} parameter kind.`,
      };
    }
    genericArguments.push(argument);
  }
  const substitutions = {
    types: typeSubstitutions,
    values: valueSubstitutions,
    origins: originSubstitutions,
    packs: new Map(),
  };
  const receiverType = sourceCall.sourceReceiver === undefined
    ? undefined
    : resolve(sourceCall.sourceReceiver.type, sourceCall.sourceReceiver.authoredTypeNode);
  const constructedType = contract.kind === "constructor"
    ? resolve(sourceCall.sourceResultType)
    : undefined;
  const ownerInstance = contract.kind === "constructor" ? constructedType : receiverType;
  const invocationContract = contract.kind === "constructor" && callable.implementation !== undefined
    ? callable.implementation
    : contract;
  const declaredParameterTypes = invocationContract.parameters.map((parameter) =>
    parameter.omissionKind === "rest" ? parameter.type : parameter.callType);
  const ownerParameterTypes = declaredParameterTypes.map((type) =>
    instantiateProjectContractType(invocationContract, ownerInstance, type, context));
  const ownerCallTypes = invocationContract.parameters.map((parameter) =>
    instantiateProjectContractType(invocationContract, ownerInstance, parameter.callType, context));
  if (ownerParameterTypes.some((type) => type === undefined) ||
    ownerCallTypes.some((type) => type === undefined)) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_CALL_OWNER_SUBSTITUTION_UNRESOLVED",
      reason: "A selected project call cannot instantiate its member contract through the exact owning type.",
    };
  }
  const parameterTypes = (ownerParameterTypes as readonly MojoTargetTypeRef[]).map((type) =>
    substituteMojoTargetType(type, substitutions));
  const targetArguments = invocationContract.parameters.map((parameter, index) => Object.freeze({
    convention: mojoParameterConvention(parameter.disposition),
    position: "positional-or-keyword" as const,
    variadic: parameter.omissionKind === "rest",
    ...(parameter.omissionKind === "rest"
      ? { variadicCollectionType: substituteMojoTargetType(ownerCallTypes[index]!, substitutions) }
      : {}),
    passing: mojoParameterArgumentDisposition(parameter.disposition).kind === "transfer"
      ? "consume" as const
      : "plain" as const,
  }));
  const arguments_ = analyzeArguments(
    context.source.ast,
    sourceCall,
    parameterTypes,
    targetArguments,
    resolve,
    context.expressionTypes,
    context.valueRefinements,
    context.lifecycle,
    context.valueOwnership,
    undefined,
    (expression) => context.source.ast.is.IsObjectLiteralExpression(expression),
    context.projectRelationships,
  );
  if (arguments_.kind === "unsupported") return arguments_;
  const locationConflict = locationBackedMutableArgument(
    arguments_.arguments,
    targetArguments,
    context,
  );
  if (locationConflict !== undefined) return locationConflict;
  const ownerResultType = instantiateProjectContractType(
    contract,
    ownerInstance,
    contract.resultType,
    context,
  );
  if (ownerResultType === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROJECT_CALL_RESULT_OWNER_SUBSTITUTION_UNRESOLVED",
      reason: "A selected project call cannot instantiate its result through the exact owning type.",
    };
  }
  const targetOutput = substituteMojoTargetType(ownerResultType, substitutions);
  const targetResult = contract.asynchronous
    ? Object.freeze({
        kind: "future" as const,
        domain: contract.asyncDomain ?? "native",
        output: targetOutput,
        raises: contract.raises,
      })
    : targetOutput;
  const callResult = contract.kind === "constructor"
    ? constructedType
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
  const target = projectCallTarget(callable, sourceCall, callResult, resolve, context);
  if (target.kind === "unsupported") return target;
  return {
    kind: "resolved",
    dependency: callable.implementation?.declaration ?? contract.declaration,
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

function instantiateProjectContractType(
  contract: MojoAnalyzedProjectCallable["contract"],
  ownerInstance: MojoTargetTypeRef | undefined,
  type: MojoTargetTypeRef,
  context: MojoCallAnalysisContext,
): MojoTargetTypeRef | undefined {
  if (contract.owner === undefined) return type;
  return ownerInstance === undefined
    ? undefined
    : context.projectRelationships.instantiateMemberType(
        contract.declaration,
        ownerInstance,
        type,
      );
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
  for (const argument of arguments_) {
    const convention = targets[argument.parameterIndex]?.convention;
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
  callable: MojoAnalyzedProjectCallable,
  sourceCall: ResolvedSourceCallInfo,
  resultType: MojoTargetTypeRef,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): { readonly kind: "resolved"; readonly target: Extract<MojoCallSelection, { kind: "project" }>["target"] } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const contract = callable.contract;
  const implementation = callable.implementation;
  if (contract.kind === "constructor") {
    return { kind: "resolved", target: Object.freeze({ kind: "constructor", type: resultType }) };
  }
  if (contract.kind === "function") {
    if (implementation === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_FUNCTION_IMPLEMENTATION_MISSING",
        reason: "A selected project function contract has no exact implementation.",
      };
    }
    return {
      kind: "resolved",
      target: Object.freeze({
        kind: "function",
        declaration: implementation.declaration,
        name: implementation.name,
        modulePath: Object.freeze([...context.modulePathForSourceFile(implementation.sourceFile)]),
      }),
    };
  }
  if (contract.static === true) {
    if (implementation?.owner === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_PROJECT_STATIC_METHOD_OWNER_MISSING",
        reason: "A selected static project method has no exact implementation owner.",
      };
    }
    return {
      kind: "resolved",
      target: Object.freeze({
        kind: "static-method",
        declaration: contract.declaration,
        implementationDeclaration: implementation.declaration,
        owner: implementation.owner.type,
        name: implementation.name,
      }),
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
      name: contract.name,
      declaration: contract.declaration,
      implementationDeclaration: implementation?.declaration ?? contract.declaration,
      receiver,
      receiverType: resolve(sourceCall.sourceReceiver!.type, sourceCall.sourceReceiver!.authoredTypeNode) ??
        contract.owner!.type,
      dispatch: context.source.ast.kindName(receiver) === "KindSuperKeyword" ? "exact" : "virtual",
    }),
  };
}

function projectGenericArgument(
  parameter: MojoAnalyzedProjectCallable["contract"]["typeParameters"][number],
  selected: NonNullable<ResolvedSourceCallInfo["sourceSelectedMethodTypeArguments"]>[number],
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
  contract: MojoAnalyzedProjectCallable["contract"],
): MojoTargetGenericArgument | undefined {
  if (parameter.kind === "type") {
    const type = resolve(selected.selectedType, selected.explicitTypeNode);
    return type === undefined ? undefined : Object.freeze({ kind: "type", type });
  }
  const authored = selected.explicitTypeNode;
  if (authored === undefined) return parameter.defaultArgument;
  const typeContext = {
    ast: context.source.ast,
    navigation: context.source.navigation,
    semantics: context.source.semantics.forFile(contract.sourceFile),
    sourceFacts: context.source.sourceFacts,
    providerSemantics: context.providerSemantics,
    projectTypes: context.projectTypes,
    sourceProfiles: context.sourceProfiles,
    jsEnabled: context.jsEnabled,
    ...(context.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: context.sourceCallableErrorType }),
  };
  if (parameter.kind === "origin") {
    const origin = resolveMojoSourceOrigin(authored, typeContext);
    return origin === undefined ? undefined : Object.freeze({ kind: "origin", origin });
  }
  return resolveMojoValueGenericArgument(authored, typeContext);
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
