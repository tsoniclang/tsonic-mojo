import type { Node } from "@tsonic/tsts";
import type { SourceFileSemantics, TargetSourceProgram } from "@tsonic/target-api/source";
import { ObjectLiteralProperty_SourceName } from "@tsonic/target-api/source";

export type MojoSupportedWellKnownMethod =
  | "dispose"
  | "async-dispose"
  | "match"
  | "match-all"
  | "replace"
  | "search"
  | "split";

export function mojoProjectMemberName(
  declaration: Node,
  semantics: SourceFileSemantics,
  ast: TargetSourceProgram["ast"],
): string | undefined {
  const name = ast.name(declaration);
  if (name === undefined) return undefined;
  if (ast.is.IsPrivateIdentifier(name)) return ast.text(name);
  const selectedName = ObjectLiteralProperty_SourceName(ast, declaration);
  if (selectedName.kind === "resolved") return selectedName.name;
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
