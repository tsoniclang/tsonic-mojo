import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "./model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoTargetTypeKey } from "../../policy/conversions/selection.js";

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

export function providerCallRequiresRaisingConversion(
  selection: Extract<MojoCallSelection, { readonly kind: "provider" }>,
): boolean {
  return selection.arguments.some((argument) => mojoConversionRaises(argument.conversion)) ||
    (selection.receiverConversion !== undefined && mojoConversionRaises(selection.receiverConversion)) ||
    mojoConversionRaises(selection.resultConversion);
}

export function mojoConversionRaises(conversion: MojoValueConversion): boolean {
  switch (conversion.kind) {
    case "js-to-native-string": return true;
    case "collection-map":
      return conversion.elementConversion !== undefined &&
        mojoConversionRaises(conversion.elementConversion);
    case "optional-some":
    case "optional-map":
    case "optional-present":
    case "optional-to-union":
    case "union-inject":
      return mojoConversionRaises(conversion.valueConversion);
    case "union-map":
      return conversion.members.some((member) => mojoConversionRaises(member.conversion));
    default: return false;
  }
}

export function propagateMojoErrorEffects(
  owners: readonly Node[],
  direct: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
  dependencies: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlyMap<Node, readonly MojoTargetTypeRef[]> {
  const result = new Map(owners.map((owner) => [
    owner,
    mergeMojoErrorTypes(direct.get(owner) ?? []),
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const owner of owners) {
      const current = result.get(owner) ?? [];
      const next = mergeMojoErrorTypes(
        current,
        ...[...(dependencies.get(owner) ?? [])].map((dependency) => result.get(dependency) ?? []),
      );
      if (next.length !== current.length ||
        next.some((type, index) => !mojoTargetTypeEquals(type, current[index]!))) {
        result.set(owner, next);
        changed = true;
      }
    }
  }
  return result;
}
