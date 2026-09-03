import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "./model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import {
  mergeMojoErrorTypes,
} from "../../target-model/types/error-domains.js";
export {
  closeMojoErrorType,
  mergeMojoErrorTypes,
  mojoNativeErrorType,
  mojoOperationErrorTypes,
} from "../../target-model/types/error-domains.js";

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
    case "union-to-optional":
      return conversion.presentMembers.some((member) => mojoConversionRaises(member.conversion));
    case "union-map":
    case "narrowed-union-map":
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
