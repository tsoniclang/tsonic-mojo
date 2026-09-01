import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoSourceProfileCallbackContract } from "../../policy/operations/source-profile-selection.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoSourceProfileCallbackSelection =
  | {
      readonly kind: "resolved";
      readonly parameterIndex: number;
      readonly targetName: string;
      readonly type: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
      readonly conversion?: MojoValueConversion;
    }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function selectMojoSourceProfileCallback(
  contract: MojoSourceProfileCallbackContract,
  sourceCall: ResolvedSourceCallInfo,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): MojoSourceProfileCallbackSelection {
  const bindings = sourceCall.sourceArgumentBindings.filter((binding) =>
    binding.sourceParameterIndex === contract.parameterIndex);
  const sourceIndexes = [...new Set(bindings.map((binding) => binding.sourceArgumentIndex))];
  if (sourceIndexes.length !== 1) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALLBACK_BINDING_NOT_EXACT",
      reason: "A source-profile callback requires one exact source argument bound to its selected parameter.",
    };
  }
  const sourceArgument = sourceCall.sourceArguments[sourceIndexes[0]!];
  const type = sourceArgument === undefined
    ? undefined
    : expressionTypes.get(sourceArgument.expression) ?? resolve(sourceArgument.type);
  if (type?.kind !== "callable") {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALLBACK_CARRIER_NOT_CLOSED",
      reason: "A source-profile callback requires one exact callable carrier for the authored argument.",
    };
  }
  const targetType = contract.result === "bool"
    ? Object.freeze({
        ...type,
        result: Object.freeze({ kind: "source-primitive" as const, name: "bool" as const }),
        raises: true,
      })
    : Object.freeze({ ...type, raises: true });
  const conversion = contract.result === "bool" &&
      (type.result.kind !== "source-primitive" || type.result.name !== "bool")
    ? callbackTruthinessConversion(type, targetType)
    : undefined;
  if (contract.result === "bool" && conversion === null) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALLBACK_TRUTHINESS_NOT_CLOSED",
      reason: "This JavaScript callback result has no exact target truthiness conversion.",
    };
  }
  const selectedConversion = conversion ?? undefined;
  if (contract.result === "float64" &&
    (type.result.kind !== "source-primitive" || type.result.name !== "float64")) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALLBACK_RESULT_NOT_CLOSED",
      reason: "This JavaScript callback requires one exact Float64 result carrier.",
    };
  }
  const variants = contract.variants.filter((variant) => variant.arity === type.parameters.length);
  if (variants.length !== 1) {
    return {
      kind: "unsupported",
      code: variants.length === 0
        ? "MOJO_SOURCE_PROFILE_CALLBACK_ARITY_UNSUPPORTED"
        : "MOJO_SOURCE_PROFILE_CALLBACK_ARITY_AMBIGUOUS",
      reason: `The authored callback arity ${type.parameters.length} has ${variants.length} exact target variants.`,
    };
  }
  return Object.freeze({
    kind: "resolved",
    parameterIndex: contract.parameterIndex,
    targetName: variants[0]!.targetName,
    type: targetType,
    ...(selectedConversion === undefined ? {} : { conversion: selectedConversion }),
  });
}

function callbackTruthinessConversion(
  sourceType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  targetType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
): MojoValueConversion | null {
  const result = sourceType.result;
  let source: Extract<MojoValueConversion, { readonly kind: "js-callback-truthiness" }>["source"];
  if (result.kind === "source-primitive" && result.name === "float64") source = "number";
  else if (result.kind === "target-named" && result.id === "tsonic.mojo.js.JsString") source = "string";
  else if (result.kind === "dynamic" && result.domain === "js") source = "dynamic";
  else if (result.kind === "null" || result.kind === "undefined" || result.kind === "unit") source = "always-false";
  else if (result.kind === "target-named" || result.kind === "list" || result.kind === "fixed-array" ||
    result.kind === "dictionary" || result.kind === "tuple" || result.kind === "callable" ||
    result.kind === "reference" || result.kind === "function") source = "always-true";
  else return null;
  return Object.freeze({
    kind: "js-callback-truthiness",
    targetType,
    source,
    widenRaises: !sourceType.raises,
  });
}
