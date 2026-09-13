import type { MojoTargetTypeRef } from "../types/model.js";

export function mojoOriginConstraintType(mutable: boolean | undefined): MojoTargetTypeRef {
  const name = mutable === undefined ? "Origin" : mutable ? "MutOrigin" : "ImmOrigin";
  return Object.freeze({
    kind: "target-named",
    id: `mojo.builtin.${name}`,
    modulePath: Object.freeze(mutable === undefined ? [] : ["std", "origin"]),
    name,
  });
}
