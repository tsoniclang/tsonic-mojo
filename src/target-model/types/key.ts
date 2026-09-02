import type { MojoTargetTypeRef } from "./model.js";

export function mojoTargetTypeKey(type: MojoTargetTypeRef): string {
  return JSON.stringify(type);
}
