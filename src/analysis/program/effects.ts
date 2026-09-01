import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedFunction,
  MojoCallSelection,
} from "./model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";

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

export function propagateRaisingEffects(
  functions: readonly MojoAnalyzedFunction[],
  direct: ReadonlyMap<Node, boolean>,
  dependencies: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlyMap<Node, boolean> {
  const result = new Map(functions.map((function_) => [
    function_.declaration,
    direct.get(function_.declaration) === true,
  ]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const function_ of functions) {
      if (result.get(function_.declaration) === true) continue;
      const raises = [...(dependencies.get(function_.declaration) ?? [])]
        .some((dependency) => result.get(dependency) === true);
      if (raises) {
        result.set(function_.declaration, true);
        changed = true;
      }
    }
  }
  return result;
}
