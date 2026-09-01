import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoSourceProfileCallbackContract } from "../../policy/operations/source-profile-selection.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoSourceProfileCallbackSelection =
  | {
      readonly kind: "resolved";
      readonly parameterIndex: number;
      readonly targetName: string;
      readonly type: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
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
  if (contract.result === "bool" &&
    (type.result.kind !== "source-primitive" || type.result.name !== "bool")) {
    return {
      kind: "unsupported",
      code: "MOJO_SOURCE_PROFILE_CALLBACK_TRUTHINESS_NOT_CLOSED",
      reason: "This JavaScript callback result requires an exact Boolean carrier until a target truthiness conversion is selected.",
    };
  }
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
    type: Object.freeze({ ...type, raises: true }),
  });
}
