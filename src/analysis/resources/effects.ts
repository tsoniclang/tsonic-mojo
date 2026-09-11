import type { Node } from "@tsonic/tsts";
import type { MojoCallSelection } from "../program/model.js";
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
    case "provider-record": return conversion.fields.some((field) => mojoConversionRaises(field.conversion));
    case "js-value-extract": return true;
    case "js-to-native-string": return true;
    case "native-error-result-unwrap": return true;
    case "js-data-rest": return mojoConversionRaises(conversion.elementConversion);
    case "collection-map":
      return conversion.source === "js-array" && conversion.elementConversion !== undefined ||
        (conversion.elementConversion !== undefined &&
          mojoConversionRaises(conversion.elementConversion));
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

export function mojoConversionDependencies(conversion: MojoValueConversion): readonly Node[] {
  switch (conversion.kind) {
    case "provider-record": return Object.freeze(conversion.fields.flatMap((field) => [
      ...(field.read.kind === "accessor" ? [field.read.declaration] : []),
      ...mojoConversionDependencies(field.conversion),
    ]));
    case "optional-some":
    case "optional-map":
    case "optional-present":
    case "optional-to-union":
    case "union-inject": return mojoConversionDependencies(conversion.valueConversion);
    case "union-to-optional": return conversion.presentMembers.flatMap((member) => mojoConversionDependencies(member.conversion));
    case "union-map":
    case "narrowed-union-map": return conversion.members.flatMap((member) => mojoConversionDependencies(member.conversion));
    default: return Object.freeze([]);
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
