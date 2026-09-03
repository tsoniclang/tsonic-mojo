import type { Node } from "@tsonic/tsts";
import type { SourceFileSemantics, TargetSourceProgram } from "@tsonic/target-api/source";

export type MojoSupportedWellKnownMethod =
  | "dispose"
  | "async-dispose"
  | "match"
  | "match-all"
  | "replace"
  | "search"
  | "split";

export function mojoProjectMethodName(
  name: Node,
  semantics: SourceFileSemantics,
  ast: TargetSourceProgram["ast"],
): string | undefined {
  if (ast.is.IsIdentifier(name) || ast.is.IsPrivateIdentifier(name)) return ast.text(name);
  const kind = mojoSupportedWellKnownMethod(name, semantics);
  if (kind === undefined) return undefined;
  switch (kind) {
    case "dispose": return "dispose";
    case "async-dispose": return "disposeAsync";
    case "match": return "symbolMatch";
    case "match-all": return "symbolMatchAll";
    case "replace": return "symbolReplace";
    case "search": return "symbolSearch";
    case "split": return "symbolSplit";
  }
}

export function mojoSupportedWellKnownMethod(
  name: Node,
  semantics: SourceFileSemantics,
): MojoSupportedWellKnownMethod | undefined {
  const selected = semantics.operations.wellKnownSymbol(name)?.kind;
  switch (selected) {
    case "dispose":
    case "async-dispose":
    case "match":
    case "match-all":
    case "replace":
    case "search":
    case "split":
      return selected;
    default:
      return undefined;
  }
}
