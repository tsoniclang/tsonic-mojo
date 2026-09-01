import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";

export function mojoStateStorageType(
  stateType: MojoTargetTypeRef,
  storage: "direct" | "erased",
): MojoTargetTypeRef {
  return storage === "direct"
    ? Object.freeze({
        kind: "target-named",
        id: "mojo.std.memory.ArcPointer",
        modulePath: Object.freeze(["std", "memory"]),
        name: "ArcPointer",
        genericArguments: Object.freeze([{ kind: "type" as const, type: stateType }]),
      })
    : Object.freeze({
        kind: "target-named",
        id: "tsonic.mojo.runtime.SharedReference",
        modulePath: Object.freeze(["tsonic_runtime"]),
        name: "SharedReference",
        genericArguments: Object.freeze([{ kind: "type" as const, type: stateType }]),
      });
}
