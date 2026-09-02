import { mojoTargetTypeEquals } from "./equality.js";
import { mojoTargetTypeKey } from "./key.js";
import type { MojoTargetTypeRef } from "./model.js";

const nativeErrorType: MojoTargetTypeRef = Object.freeze({
  kind: "target-named",
  id: "mojo.builtin.Error",
  modulePath: Object.freeze([]),
  name: "Error",
});

export function mojoNativeErrorType(): MojoTargetTypeRef {
  return nativeErrorType;
}

export function mojoOperationErrorTypes(operation: {
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
}): readonly MojoTargetTypeRef[] {
  return operation.raises
    ? Object.freeze([operation.errorType ?? nativeErrorType])
    : Object.freeze([]);
}

export function mergeMojoErrorTypes(
  ...groups: readonly (readonly MojoTargetTypeRef[])[]
): readonly MojoTargetTypeRef[] {
  const byKey = new Map<string, MojoTargetTypeRef>();
  const add = (type: MojoTargetTypeRef): void => {
    if (type.kind === "union") {
      for (const member of type.members) add(member);
      return;
    }
    const key = mojoTargetTypeKey(type);
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, type);
    else if (!mojoTargetTypeEquals(existing, type)) {
      throw new Error(`Mojo error-domain key '${key}' identifies conflicting target types.`);
    }
  };
  for (const group of groups) for (const type of group) add(type);
  return Object.freeze([...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([, type]) => type));
}

export function closeMojoErrorType(
  types: readonly MojoTargetTypeRef[],
): MojoTargetTypeRef | undefined {
  const members = mergeMojoErrorTypes(types);
  if (members.length === 0) return undefined;
  if (members.length === 1) return members[0];
  return Object.freeze({ kind: "union", members });
}
