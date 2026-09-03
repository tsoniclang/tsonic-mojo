import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import { classifyMojoRefinedValueConversion } from "../refinements/value.js";
import { selectMojoSourceProfileCallRow } from "../../policy/operations/source-profile-selection.js";
import type {
  MojoSourceProfileCallRow,
  MojoSourceProfileParameterContract,
} from "../../policy/operations/source-profile-selection.js";
import {
  mojoDynamicTargetType,
  mojoNamedTargetType,
  mojoPrimitiveTargetType,
  mojoStringTargetType,
} from "../../target-model/types/constructors.js";
import type { MojoCallAnalysis, MojoCallAnalysisContext } from "./calls.js";
import {
  analyzeArguments,
  closeResultConversion,
  restCallableElementType,
} from "./call-arguments.js";
import { selectMojoSourceProfileCallback } from "./source-profile-callbacks.js";

export function analyzeSourceProfileCall(
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
  const parameterContractMode = selected.row.parameterContractMode ?? "exact";
  const sourceReceiver = sourceCall.sourceReceiver;
  const exactReceiverType = sourceReceiver === undefined
    ? undefined
    : context.expressionTypes.get(sourceReceiver.expression) ?? resolve(
        sourceReceiver.type,
        sourceReceiver.authoredTypeNode ?? (sourceReceiver.declaration === undefined
          ? undefined
          : context.source.ast.typeNode(sourceReceiver.declaration)),
      );
  const sourceReceiverType = sourceCall.optionalChain && exactReceiverType?.kind === "optional"
    ? exactReceiverType.value
    : exactReceiverType;
  const callback = selected.row.callback === undefined
    ? undefined
    : selectMojoSourceProfileCallback(
        selected.row.callback,
        sourceCall,
        resolve,
        context.expressionTypes,
      );
  if (callback?.kind === "unsupported") return callback;
  if (parameterContractMode === "exact" && parameterContract !== undefined &&
    (parameterContract.length > sourceCall.sourceSelectedSignatureParameters.length ||
      sourceCall.sourceArgumentBindings.some((binding) =>
        binding.sourceParameterIndex >= parameterContract.length))) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_PARAMETER_CONTRACT_INVALID",
      reason: `The exact source-profile overload '${selected.row.owner}.${selected.row.member}' cannot be represented by its Mojo runtime parameter contract.`,
    };
  }
  const selectedParameters = parameterContractMode === "exact" && parameterContract !== undefined
    ? sourceCall.sourceSelectedSignatureParameters.slice(0, parameterContract.length)
    : sourceCall.sourceSelectedSignatureParameters;
  for (const [parameterIndex, parameter] of selectedParameters.entries()) {
    const explicitContract = parameterContract?.[parameterIndex];
    const resolved = callback?.parameterIndex === parameterIndex
      ? callback.type
      : explicitContract === "selected-argument"
        ? selectedSourceProfileArgumentType(
            parameterIndex,
            sourceCall,
            resolve,
            context.expressionTypes,
          )
      : explicitContract === undefined
        ? resolve(parameter.selectedType, parameter.authoredTypeNode)
        : sourceProfileParameterType(explicitContract, sourceReceiverType);
    const presentType = resolved === undefined
      ? undefined
      : sourceProfilePresentArgumentType(parameter.acceptsOmission, resolved);
    const target = parameter.rest === true && presentType !== undefined && explicitContract === undefined
      ? restCallableElementType(presentType)
      : presentType;
    if (target === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_PARAMETER_NOT_CLOSED",
        reason: `Source-profile parameter ${parameter.parameterIndex} has no exact Mojo carrier for contract '${JSON.stringify(explicitContract)}' and receiver '${JSON.stringify(sourceReceiverType)}'.`,
      };
    }
    parameterTypes.push(target);
    const variadicCollectionType = parameter.rest
      ? explicitContract === undefined
        ? presentType
        : mojoNamedTargetType(
            "tsonic.mojo.js.JsArray",
            ["tsonic_js"],
            "JsArray",
            [target],
          )
      : undefined;
    targetArguments.push(Object.freeze({
      convention: "imm",
      position: "positional-or-keyword",
      variadic: parameter.rest,
      ...(variadicCollectionType === undefined ? {} : { variadicCollectionType }),
      passing: "plain",
    }));
  }
  const arguments_ = analyzeArguments(
    sourceCall,
    parameterTypes,
    targetArguments,
    resolve,
    context.expressionTypes,
    context.valueRefinements,
    context.lifecycle,
    context.valueOwnership,
    callback?.conversion === undefined
      ? undefined
      : new Map([[callback.parameterIndex, callback.conversion]]),
  );
  if (arguments_.kind === "unsupported") return arguments_;
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
  let receiverConversion;
  if (selected.row.target.kind === "instance" || selected.row.target.receiver !== undefined) {
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
    const conversion = classifyMojoRefinedValueConversion(
      sourceReceiverType,
      sourceReceiverType,
      sourceCall.sourceReceiver === undefined
        ? undefined
        : context.valueRefinements.get(sourceCall.sourceReceiver.expression),
    );
    if (conversion.kind === "unsupported") return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_RECEIVER_CONVERSION_UNPROVEN",
      reason: conversion.reason,
    };
    receiverConversion = conversion.conversion;
  }
  const result = closeSourceProfileResult(
    selected.row,
    sourceCall,
    sourceReceiverType,
    resolve,
    context,
  );
  if (result.kind === "unsupported") return result;
  return {
    kind: "resolved",
    selection: Object.freeze({
      kind: "provider",
      operation: Object.freeze({
        target,
        ...(sourceReceiverType === undefined ? {} : { receiverType: sourceReceiverType }),
        parameterTypes: Object.freeze(parameterTypes),
        resultType: result.type,
        genericArguments: Object.freeze(genericArguments),
        genericParameters: Object.freeze([]),
        raises: selected.row.raises === true,
        ...(selected.row.raises !== true || callback?.type.errorType === undefined
          ? {}
          : { errorType: callback.type.errorType }),
      }),
      arguments: arguments_.arguments,
      ...(callback === undefined || selected.row.callback?.errorMode !== "propagate"
        ? {}
        : { propagatedCallbackParameterIndex: callback.parameterIndex }),
      ...(receiver === undefined ? {} : { receiver }),
      ...(sourceReceiverType === undefined ? {} : { sourceReceiverType }),
      ...(receiverConversion === undefined ? {} : { receiverConversion }),
      resultConversion: result.conversion,
      optionalChain: sourceCall.optionalChain,
    }),
  };
}

function sourceProfilePresentArgumentType(
  acceptsOmission: boolean,
  type: MojoTargetTypeRef,
): MojoTargetTypeRef {
  return !acceptsOmission || type.kind !== "optional" ? type : type.value;
}

type ClosedSourceProfileResult =
  | {
      readonly kind: "resolved";
      readonly type: MojoTargetTypeRef;
      readonly conversion: MojoValueConversion;
    }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

function closeSourceProfileResult(
  row: MojoSourceProfileCallRow,
  sourceCall: ResolvedSourceCallInfo,
  sourceReceiverType: MojoTargetTypeRef | undefined,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): ClosedSourceProfileResult {
  if (row.resultContract?.kind === "receiver-argument") {
    if (sourceReceiverType?.kind !== "target-named") {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_RESULT_CONTRACT_INVALID",
        reason: "A receiver-derived source-profile result requires one exact generic receiver carrier.",
      };
    }
    const argument = sourceReceiverType.genericArguments?.[row.resultContract.index];
    if (argument?.kind !== "type") {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_RESULT_CONTRACT_INVALID",
        reason: "The selected source-profile receiver does not supply the required result type argument.",
      };
    }
    return Object.freeze({
      kind: "resolved",
      type: row.resultContract.optional
        ? Object.freeze({ kind: "optional" as const, value: argument.type })
        : argument.type,
      conversion: Object.freeze({ kind: "identity" }),
    });
  }
  if (row.resultContract?.kind === "receiver-array") {
    if (sourceReceiverType?.kind !== "target-named") {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_RESULT_CONTRACT_INVALID",
        reason: "A receiver-derived source-profile result requires one exact generic receiver carrier.",
      };
    }
    const arguments_ = sourceReceiverType.genericArguments ?? [];
    const element = row.resultContract.element;
    let elementType: MojoTargetTypeRef | undefined;
    if (element.kind === "receiver-argument") {
      const argument = arguments_[element.index];
      elementType = argument?.kind === "type" ? argument.type : undefined;
    } else {
      const elements = element.indexes.map((index) => {
        const argument = arguments_[index];
        return argument?.kind === "type" ? argument.type : undefined;
      });
      if (elements.every((candidate) => candidate !== undefined)) {
        elementType = Object.freeze({
          kind: "tuple",
          elements: Object.freeze(elements as readonly MojoTargetTypeRef[]),
        });
      }
    }
    if (elementType === undefined) {
      return {
        kind: "unsupported",
        code: "MOJO_SOURCE_PROFILE_RESULT_CONTRACT_INVALID",
        reason: "The selected source-profile receiver does not supply every required result type argument.",
      };
    }
    return Object.freeze({
      kind: "resolved",
      type: mojoNamedTargetType(
        "tsonic.mojo.js.JsArray",
        ["tsonic_js"],
        "JsArray",
        [elementType],
      ),
      conversion: Object.freeze({ kind: "identity" }),
    });
  }

  const selectedResult = resolve(sourceCall.sourceResultType);
  if (selectedResult === undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_RESULT_NOT_CLOSED",
      reason: "The selected source-profile call result has no exact Mojo carrier.",
    };
  }
  if (row.resultContract?.kind === "constructed-explicit-arguments") {
    const explicitNodes = context.source.ast.typeArguments(sourceCall.call)
      .filter((node): node is Node => node !== undefined);
    if (explicitNodes.length !== 0) {
      const indexes = row.resultContract.indexes ?? explicitNodes.map((_, index) => index);
      const selectedNodes = indexes.map((index) => explicitNodes[index]);
      const existingArguments = selectedResult.kind === "target-named"
        ? selectedResult.genericArguments ?? []
        : [];
      if (selectedResult.kind !== "target-named" ||
        selectedNodes.some((node) => node === undefined) ||
        existingArguments.length !== selectedNodes.length ||
        existingArguments.some((argument) => argument.kind !== "type")) {
        return {
          kind: "unsupported",
          code: "MOJO_SOURCE_PROFILE_RESULT_CONTRACT_INVALID",
          reason: "Explicit source-profile result arguments do not align with the selected target carrier.",
        };
      }
      const semantics = context.source.semantics.forNode(sourceCall.call);
      const resolvedArguments = selectedNodes.map((node) => {
        const selectedType = node === undefined ? undefined : semantics.types.authoredType(node);
        return selectedType === undefined || node === undefined ? undefined : resolve(selectedType, node);
      });
      if (resolvedArguments.some((argument) => argument === undefined)) {
        return {
          kind: "unsupported",
          code: "MOJO_SOURCE_PROFILE_RESULT_NOT_CLOSED",
          reason: "An explicit source-profile result type argument has no exact Mojo carrier.",
        };
      }
      return Object.freeze({
        kind: "resolved",
        type: Object.freeze({
          ...selectedResult,
          genericArguments: Object.freeze((resolvedArguments as readonly MojoTargetTypeRef[]).map(
            (type): MojoTargetGenericArgument => Object.freeze({ kind: "type", type }),
          )),
        }),
        conversion: Object.freeze({ kind: "identity" }),
      });
    }
  }
  const conversion = closeResultConversion(
    selectedResult,
    sourceCall.sourceResultType,
    resolve,
  );
  return conversion.kind === "unsupported"
    ? conversion
    : Object.freeze({ kind: "resolved", type: selectedResult, conversion: conversion.conversion });
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
  receiver: MojoTargetTypeRef | undefined,
): MojoTargetTypeRef | undefined {
  if (typeof contract !== "string") {
    if (contract.kind === "receiver") return receiver;
    const value = receiver?.kind === "optional" ? receiver.value : receiver;
    if (value?.kind !== "target-named") return undefined;
    const argument = value.genericArguments?.[contract.index];
    return argument?.kind === "type" ? argument.type : undefined;
  }
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
    case "native-string":
      return mojoStringTargetType();
    case "selected-argument":
      return undefined;
  }
}

function selectedSourceProfileArgumentType(
  parameterIndex: number,
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type, authoredTypeNode?: Node) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoTargetTypeRef | undefined {
  const bindings = sourceCall.sourceArgumentBindings.filter((binding) =>
    binding.sourceParameterIndex === parameterIndex);
  const argumentIndexes = [...new Set(bindings.map((binding) => binding.sourceArgumentIndex))];
  if (bindings.length === 0 || argumentIndexes.length !== 1) return undefined;
  const argument = sourceCall.sourceArguments[argumentIndexes[0]!];
  const selectedTypes = bindings.map((binding) => binding.selectedArgumentType);
  if (argument === undefined || selectedTypes.some((type) => type !== selectedTypes[0])) return undefined;
  return expressionTypes.get(argument.expression) ?? resolve(selectedTypes[0]!);
}
