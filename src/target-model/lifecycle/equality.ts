import type { MojoNamedLifecycleContract } from "./model.js";

export function mojoNamedLifecycleEquals(
  left: MojoNamedLifecycleContract,
  right: MojoNamedLifecycleContract,
): boolean {
  if (left.kind === "fixed") {
    if (right.kind !== "fixed") return false;
    return left.capabilities.copy === right.capabilities.copy &&
      left.capabilities.movable === right.capabilities.movable &&
      left.capabilities.deinitializable === right.capabilities.deinitializable &&
      left.capabilities.registerPassing === right.capabilities.registerPassing &&
      left.capabilities.explicitDestruction === right.capabilities.explicitDestruction;
  }
  return right.kind === "aggregate" &&
    left.implicitCopyWhenPossible === right.implicitCopyWhenPossible &&
    left.explicitDestruction === right.explicitDestruction &&
    left.genericArgumentIndexes.length === right.genericArgumentIndexes.length &&
    left.genericArgumentIndexes.every((value, index) => value === right.genericArgumentIndexes[index]);
}
