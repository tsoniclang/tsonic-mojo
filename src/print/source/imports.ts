import type { MojoImportDeclaration } from "../../backend/target-ast/index.js";
import {
  concat,
  emptyDocument,
  group,
  hardLine,
  ifBreak,
  indent,
  join,
  line,
  text,
} from "../document/builders.js";
import type { MojoDocument } from "../document/model.js";

export function printMojoImportDocument(import_: MojoImportDeclaration): MojoDocument {
  const path = import_.modulePath.join(".");
  if (import_.kind === "module") {
    return text(`import ${path}${import_.alias === undefined ? "" : ` as ${import_.alias}`}`);
  }
  const symbols = import_.symbols.map((symbol) => text(
    `${symbol.name}${symbol.alias === undefined ? "" : ` as ${symbol.alias}`}`,
  ));
  if (symbols.length === 0) throw new Error(`Mojo symbol import '${path}' has no symbols.`);
  return group(concat(
    text(`from ${path} import `),
    ifBreak(text("("), emptyDocument),
    indent(4, concat(
      ifBreak(hardLine, emptyDocument),
      join(concat(text(","), line), symbols),
      ifBreak(text(","), emptyDocument),
    )),
    ifBreak(hardLine, emptyDocument),
    ifBreak(text(")"), emptyDocument),
  ));
}
