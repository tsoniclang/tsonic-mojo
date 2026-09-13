import type { MojoTargetTypeRef } from "./model.js";

export function closeMojoCallableResult(type: MojoTargetTypeRef): MojoTargetTypeRef {
  if (type.kind === "future" && type.domain === "native") {
    return Object.freeze({ ...type, captureOrigins: "empty", raises: true });
  }
  if (type.kind === "optional") {
    return Object.freeze({ ...type, value: closeMojoCallableResult(type.value) });
  }
  if (type.kind === "union") {
    return Object.freeze({
      ...type,
      members: Object.freeze(type.members.map(closeMojoCallableResult)),
    });
  }
  return type;
}
