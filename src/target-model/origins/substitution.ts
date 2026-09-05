import type { MojoOriginRef } from "./model.js";

export function substituteMojoOrigin(
  origin: MojoOriginRef,
  substitutions: ReadonlyMap<string, MojoOriginRef>,
): MojoOriginRef {
  return origin.kind === "parameter"
    ? substitutions.get(origin.name) ?? origin
    : origin;
}
