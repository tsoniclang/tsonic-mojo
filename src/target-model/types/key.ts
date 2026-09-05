import type { MojoTargetTypeRef } from "./model.js";

export function mojoTargetTypeKey(type: MojoTargetTypeRef): string {
  return JSON.stringify(type, (name, value) =>
    name === "lifecycle" || name === "lifecycleRequirement" ||
      name === "lifecycleRequirements" ? undefined : value);
}
