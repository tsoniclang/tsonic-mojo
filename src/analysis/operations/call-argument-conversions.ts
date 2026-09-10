import type { ResolvedSourceCallInfo } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";

export type MojoSelectedArgumentBinding = ResolvedSourceCallInfo["sourceArgumentBindings"][number];
export type MojoArgumentConversionMap = ReadonlyMap<MojoSelectedArgumentBinding, MojoValueConversion>;

export function parameterBindingConversions(
  call: ResolvedSourceCallInfo,
  parameters: ReadonlyMap<number, MojoValueConversion>,
): MojoArgumentConversionMap {
  const result = new Map<MojoSelectedArgumentBinding, MojoValueConversion>();
  for (const binding of call.sourceArgumentBindings) {
    const conversion = parameters.get(binding.sourceParameterIndex);
    if (conversion !== undefined) result.set(binding, conversion);
  }
  return result;
}
