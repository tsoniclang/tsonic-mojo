import { jsRegExpSourceProfileIdentity } from "@tsonic/js-source-profile";
import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import {
  mojoParameterArgumentDisposition,
  mojoParameterConvention,
} from "../representations/index.js";
import type {
  MojoAnalyzedCallArgument,
  MojoAnalyzedParameter,
  MojoAnalyzedProjectCallable,
} from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { closeResultConversion, analyzeMojoArgumentDisposition } from "./call-arguments.js";
import type { MojoCallAnalysis, MojoCallAnalysisContext } from "./calls.js";
import {
  mojoSupportedWellKnownMethod,
  type MojoSupportedWellKnownMethod,
} from "../declarations/well-known-methods.js";

type RegExpProtocolKind = Extract<
  MojoSupportedWellKnownMethod,
  "match" | "match-all" | "replace" | "search" | "split"
>;

export function analyzeSourceProfileRegExpProtocolCall(
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoCallAnalysis | undefined {
  const semantics = context.source.semantics.forNode(sourceCall.call);
  const signatureDeclaration = semantics.declarations.signatureDeclaration(
    sourceCall.selectedSignature,
  );
  const identity = context.sourceProfiles.declarationIdentity(
    signatureDeclaration,
    context.source,
  );
  const protocolKind = identity?.profile === "js" &&
      (identity.declaringName ?? identity.name) === jsRegExpSourceProfileIdentity.owners.string
    ? protocolKindForStringMember(identity.name)
    : undefined;
  if (protocolKind === undefined) return undefined;

  const protocolArgument = sourceCall.sourceArguments[0];
  if (protocolArgument === undefined) return undefined;
  const selected = selectProtocolCallable(
    protocolArgument.expression,
    protocolArgument.type,
    protocolKind,
    context,
  );
  if (selected.kind === "not-project-protocol") return undefined;
  if (selected.kind === "unsupported") return selected.result;

  const callable = selected.callable;
  const contract = callable.contract;
  const receiverType = context.expressionTypes.get(protocolArgument.expression) ??
    resolve(protocolArgument.type);
  if (receiverType === undefined || contract.owner === undefined || contract.static === true ||
    contract.kind !== "method" || contract.asynchronous || contract.typeParameters.length !== 0) {
    return unsupported(
      "MOJO_REGEXP_PROTOCOL_CALLABLE_NOT_CLOSED",
      "The exact well-known RegExp protocol member is not one synchronous, non-generic project instance method with a closed receiver.",
    );
  }

  const parameters = contract.parameters.map((parameter) =>
    instantiateProtocolParameter(parameter, contract, receiverType, context));
  if (parameters.some((parameter) => parameter === undefined)) {
    return unsupported(
      "MOJO_REGEXP_PROTOCOL_SIGNATURE_NOT_CLOSED",
      "The exact well-known RegExp protocol method parameters cannot be instantiated through its selected project receiver.",
    );
  }
  const closedParameters = parameters as readonly MojoAnalyzedParameter[];
  const sourceReceiver = sourceCall.sourceReceiver;
  const effectiveValues = sourceReceiver === undefined
    ? []
    : [
        Object.freeze({
          expression: sourceReceiver.expression,
          type: sourceReceiver.type,
        }),
        ...sourceCall.sourceArguments.slice(1),
      ];
  const requiredCount = closedParameters.filter((parameter) =>
    parameter.omissionKind === "required").length;
  if (sourceReceiver === undefined || effectiveValues.length < requiredCount ||
    effectiveValues.length > closedParameters.length ||
    closedParameters.slice(effectiveValues.length).some((parameter) =>
      parameter.omissionKind === "required")) {
    return unsupported(
      "MOJO_REGEXP_PROTOCOL_ARITY_CONFLICT",
      "The checker-selected String operation and exact well-known RegExp protocol method have incompatible effective arity.",
    );
  }
  if (sourceCall.sourceArgumentBindings.some((binding) =>
    binding.sourceArgumentIndex > 0 && binding.sourceForm !== "value")) {
    return unsupported(
      "MOJO_REGEXP_PROTOCOL_SPREAD_UNSUPPORTED",
      "A well-known RegExp protocol invocation cannot forward a spread argument into its fixed selected method contract.",
    );
  }

  const arguments_: MojoAnalyzedCallArgument[] = [];
  for (const [index, value] of effectiveValues.entries()) {
    const parameter = closedParameters[index]!;
    const sourceType = context.expressionTypes.get(value.expression) ??
      resolve(value.type);
    if (sourceType === undefined) {
      return unsupported(
        "MOJO_REGEXP_PROTOCOL_ARGUMENT_NOT_CLOSED",
        `Well-known RegExp protocol argument ${index} has no exact Mojo carrier.`,
      );
    }
    const conversion = classifyMojoRefinedValueConversion(
      sourceType,
      parameter.callType,
      context.valueRefinements.get(value.expression),
      context.projectRelationships,
    );
    if (conversion.kind === "unsupported") {
      return unsupported("MOJO_REGEXP_PROTOCOL_ARGUMENT_CONFLICT", conversion.reason);
    }
    const target = Object.freeze({
      convention: mojoParameterConvention(parameter.disposition),
      position: "positional-or-keyword" as const,
      passing: mojoParameterArgumentDisposition(parameter.disposition).kind === "transfer"
        ? "consume" as const
        : "plain" as const,
    });
    const disposition = analyzeMojoArgumentDisposition(
      value.expression,
      parameter.callType,
      target,
      conversion.conversion,
      context.lifecycle,
      context.valueOwnership,
    );
    if (disposition.kind === "unsupported") return disposition;
    arguments_.push(Object.freeze({
      expression: value.expression,
      sourceType,
      parameterType: parameter.callType,
      conversion: conversion.conversion,
      disposition: disposition.disposition,
      spread: false,
      position: target.position,
      parameterIndex: index,
    }));
  }

  const targetResult = context.projectRelationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    contract.resultType,
  );
  if (targetResult === undefined) {
    return unsupported(
      "MOJO_REGEXP_PROTOCOL_RESULT_NOT_CLOSED",
      "The exact well-known RegExp protocol result cannot be instantiated through its selected project receiver.",
    );
  }
  const result = closeResultConversion(
    targetResult,
    sourceCall.sourceResultType,
    resolve,
    context.projectRelationships,
  );
  if (result.kind === "unsupported") return result;

  return Object.freeze({
    kind: "resolved",
    dependency: callable.implementation?.declaration ?? contract.declaration,
    selection: Object.freeze({
      kind: "project",
      target: Object.freeze({
        kind: "method",
        name: contract.name,
        declaration: contract.declaration,
        implementationDeclaration: callable.implementation?.declaration ?? contract.declaration,
        receiver: protocolArgument.expression,
        receiverType,
        dispatch: "virtual",
      }),
      genericArguments: Object.freeze([]),
      arguments: Object.freeze(arguments_),
      resultType: targetResult,
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  });
}

function selectProtocolCallable(
  expression: Node,
  sourceType: Type,
  kind: RegExpProtocolKind,
  context: MojoCallAnalysisContext,
):
  | { readonly kind: "not-project-protocol" }
  | { readonly kind: "selected"; readonly callable: MojoAnalyzedProjectCallable }
  | { readonly kind: "unsupported"; readonly result: MojoCallAnalysis } {
  const semantics = context.source.semantics.forNode(expression);
  const matchingProperties = semantics.types.propertyInfos(sourceType).filter((property) =>
    property.rootSymbols.some((symbol) =>
      semantics.declarations.symbolDeclarations(symbol).some((declaration) => {
        const name = context.source.ast.name(declaration);
        return name !== undefined && context.source.ast.is.IsComputedPropertyName(name) &&
          mojoSupportedWellKnownMethod(
            name,
            context.source.semantics.forNode(declaration),
          ) === kind;
      })));
  if (matchingProperties.length === 0) return { kind: "not-project-protocol" };
  const callables = new Set<MojoAnalyzedProjectCallable>();
  for (const property of matchingProperties) {
    for (const symbol of property.rootSymbols) {
      for (const declaration of semantics.declarations.symbolDeclarations(symbol)) {
        const callable = context.callableByDeclaration.get(declaration);
        if (callable !== undefined) callables.add(callable);
      }
    }
  }
  if (callables.size === 0) return { kind: "not-project-protocol" };
  if (matchingProperties.length !== 1 || matchingProperties[0]!.optional) {
    return {
      kind: "unsupported",
      result: unsupported(
        "MOJO_REGEXP_PROTOCOL_MEMBER_AMBIGUOUS",
        "The selected RegExp protocol argument does not expose exactly one required well-known-symbol member.",
      ),
    };
  }
  return callables.size === 1
    ? { kind: "selected", callable: [...callables][0]! }
    : {
        kind: "unsupported",
        result: unsupported(
          "MOJO_REGEXP_PROTOCOL_IMPLEMENTATION_UNRESOLVED",
          "The selected well-known RegExp protocol member does not resolve to one exact project callable implementation.",
        ),
      };
}

function instantiateProtocolParameter(
  parameter: MojoAnalyzedParameter,
  contract: MojoAnalyzedProjectCallable["contract"],
  receiverType: MojoTargetTypeRef,
  context: MojoCallAnalysisContext,
): MojoAnalyzedParameter | undefined {
  const type = context.projectRelationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    parameter.type,
  );
  const bodyType = context.projectRelationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    parameter.bodyType,
  );
  const callType = context.projectRelationships.instantiateMemberType(
    contract.declaration,
    receiverType,
    parameter.callType,
  );
  return type === undefined || bodyType === undefined || callType === undefined
    ? undefined
    : Object.freeze({ ...parameter, type, bodyType, callType });
}

function protocolKindForStringMember(member: string | undefined): RegExpProtocolKind | undefined {
  switch (member) {
    case "match": return "match";
    case "matchAll": return "match-all";
    case "replace":
    case "replaceAll": return "replace";
    case "search": return "search";
    case "split": return "split";
    default: return undefined;
  }
}

function unsupported(code: string, reason: string): MojoCallAnalysis {
  return Object.freeze({ kind: "unsupported", code, reason });
}
