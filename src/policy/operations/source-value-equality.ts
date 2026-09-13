import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export function mojoSourceValueEqualityKind(
  operator: string | undefined,
  left: MojoTargetTypeRef | undefined,
  right: MojoTargetTypeRef | undefined,
): "equal" | "unequal" | "coercive" | undefined {
  if (!(left?.kind === "dynamic" && left.domain === "js") &&
    !(right?.kind === "dynamic" && right.domain === "js")) return undefined;
  if (operator === "KindEqualsEqualsEqualsToken") return "equal";
  if (operator === "KindExclamationEqualsEqualsToken") return "unequal";
  if (operator === "KindEqualsEqualsToken" || operator === "KindExclamationEqualsToken") return "coercive";
  return undefined;
}
