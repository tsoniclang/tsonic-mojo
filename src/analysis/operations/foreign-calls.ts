import type { ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";
import type { MojoSelectedArgumentBinding } from "./call-argument-conversions.js";
import { selectedMojoArgumentCarrier } from "./call-argument-carriers.js";
import { hasExplicitUnsafeContext } from "../safety/explicit-context.js";
import { mojoCVariadicPromotion } from "../../policy/operations/c-abi.js";

export function analyzeMojoForeignArguments(
  call: ResolvedSourceCallInfo,
  operation: MojoSelectedProviderOperation,
  source: TargetSourceProgram,
  expressionTypes: WeakMap<import("@tsonic/tsts").Node, MojoTargetTypeRef>,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
): { readonly kind: "resolved"; readonly parameters: ReadonlyMap<MojoSelectedArgumentBinding, MojoTargetTypeRef> } |
  { readonly kind: "unsupported"; readonly code: string; readonly reason: string } {
  const parameters = new Map<MojoSelectedArgumentBinding, MojoTargetTypeRef>();
  if (operation.target.kind !== "foreign-call") return { kind: "resolved", parameters };
  if (!hasExplicitUnsafeContext(call.call, source)) return {
    kind: "unsupported", code: "MOJO_FOREIGN_CALL_UNSAFE_CONTEXT_REQUIRED",
    reason: "A selected C ABI call requires an explicit unsafeContext source region.",
  };
  for (const binding of call.sourceArgumentBindings) {
    if (binding.sourceParameterIndex < operation.target.fixedParameterCount) continue;
    if (binding.sourceForm === "spread-sequence") return {
      kind: "unsupported", code: "MOJO_C_VARIADIC_OPEN_SPREAD_UNSUPPORTED",
      reason: "A native C variadic call needs a statically known argument count, not an open sequence spread.",
    };
    const selected = selectedMojoArgumentCarrier(source.ast, call, binding, expressionTypes, resolve);
    const promoted = selected === undefined ? undefined : mojoCVariadicPromotion(selected.type);
    if (promoted === undefined) return {
      kind: "unsupported", code: "MOJO_C_VARIADIC_CARRIER_UNSUPPORTED",
      reason: "Each selected C variadic argument must have an exact native scalar or pointer carrier before C default promotion.",
    };
    parameters.set(binding, promoted);
  }
  return Object.freeze({ kind: "resolved", parameters });
}
