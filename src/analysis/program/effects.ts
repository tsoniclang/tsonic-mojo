import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedFunction,
  MojoCallSelection,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";

export function providerCallRequiresRaisingConversion(
  selection: Extract<MojoCallSelection, { readonly kind: "provider" }>,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
): boolean {
  return selection.arguments.some((argument, index) => {
    const source = expressionTypes.get(argument);
    const target = selection.operation.parameterTypes?.[index];
    return source?.kind === "target-named" &&
      source.id === "tsonic.mojo.js.JsString" && target?.kind === "native-string";
  });
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
