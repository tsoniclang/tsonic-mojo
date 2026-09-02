import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export type MojoOwnedTemporaryPassing = "plain" | "consume";

const implicitlyCopyableNamedTypes = new Set([
  "tsonic.mojo.js.JsArray",
  "tsonic.mojo.js.JsDate",
  "tsonic.mojo.js.JsMap",
  "tsonic.mojo.js.JsSet",
  "tsonic.mojo.js.JsString",
  "tsonic.mojo.runtime.Location",
  "tsonic.mojo.runtime.SharedReference",
]);

export function mojoOwnedTemporaryPassing(
  type: MojoTargetTypeRef,
  projectTypes: MojoProjectTypeCatalog,
): MojoOwnedTemporaryPassing {
  switch (type.kind) {
    case "source-primitive":
    case "unit":
    case "never":
    case "null":
    case "undefined":
      return "plain";
    case "dynamic":
      return type.domain === "js" ? "plain" : "consume";
    case "target-named":
      return projectTypes.definitionForId(type.id) !== undefined ||
        implicitlyCopyableNamedTypes.has(type.id)
        ? "plain"
        : "consume";
    case "optional":
      return mojoOwnedTemporaryPassing(type.value, projectTypes);
    case "union":
      return type.members.every((member) =>
        mojoOwnedTemporaryPassing(member, projectTypes) === "plain")
        ? "plain"
        : "consume";
    case "tuple":
      return type.elements.every((element) =>
        mojoOwnedTemporaryPassing(element, projectTypes) === "plain")
        ? "plain"
        : "consume";
    case "callable":
    case "reference":
      return "plain";
    case "native-string":
    case "bigint":
    case "symbol":
    case "type-parameter":
    case "list":
    case "fixed-array":
    case "dictionary":
    case "future":
    case "associated":
    case "compiler-expression":
    case "function":
      return "consume";
  }
}
