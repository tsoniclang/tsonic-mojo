import type { MojoDeclaration, MojoSourceModule } from "../../backend/target-ast/index.js";
import {
  concat,
  emptyDocument,
  hardLine,
  join,
} from "../document/builders.js";
import { renderMojoDocument } from "../document/render.js";
import type { MojoPrintContext } from "./context.js";
import { printMojoDeclarationDocument } from "./declarations.js";
import { printMojoImportDocument } from "./imports.js";

export interface MojoSourcePrintOptions {
  readonly width?: number;
}

export function printMojoModule(
  module: MojoSourceModule,
  options: MojoSourcePrintOptions = {},
): string {
  const aliasesByTypeKey = new Map(module.typeAliases.map((alias) =>
    [alias.typeKey, alias] as const));
  const importedSymbols = new Map<string, string>();
  const importedModules = new Map<string, string>();
  for (const import_ of module.imports) {
    if (import_.kind === "module") {
      const key = import_.modulePath.join(".");
      const localName = import_.alias ?? key;
      const previous = importedModules.get(key);
      if (previous !== undefined && previous !== localName) {
        throw new Error(`Mojo imported module '${key}' has conflicting local names.`);
      }
      importedModules.set(key, localName);
      continue;
    }
    for (const symbol of import_.symbols) {
      const key = `${import_.modulePath.join(".")}\0${symbol.name}`;
      const localName = symbol.alias ?? symbol.name;
      const previous = importedSymbols.get(key);
      if (previous !== undefined && previous !== localName) {
        throw new Error(`Mojo imported symbol '${key}' has conflicting local names.`);
      }
      importedSymbols.set(key, localName);
    }
  }
  const context: MojoPrintContext = Object.freeze({
    modulePath: module.modulePath ?? [],
    aliasesByTypeKey,
    importedSymbols,
    importedModules,
  });
  const imports = module.imports.length === 0
    ? emptyDocument
    : join(hardLine, module.imports.map(printMojoImportDocument));
  const declarations = module.declarations.length === 0
    ? emptyDocument
    : concat(...module.declarations.flatMap((declaration, index) => [
        index === 0
          ? emptyDocument
          : declarationSeparator(module.declarations[index - 1], declaration),
        printMojoDeclarationDocument(declaration, context),
      ]));
  const document = imports.kind === "empty"
    ? declarations
    : declarations.kind === "empty"
      ? imports
      : concat(imports, declarationSeparator(undefined, module.declarations[0]!), declarations);
  return renderMojoDocument(document, { width: options.width, finalNewline: true });
}

function declarationSeparator(
  previous: MojoDeclaration | undefined,
  next: MojoDeclaration,
) {
  const compound = (declaration: MojoDeclaration | undefined) =>
    declaration?.kind === "function" || declaration?.kind === "struct" || declaration?.kind === "trait";
  return compound(previous) || compound(next)
    ? concat(hardLine, hardLine, hardLine)
    : concat(hardLine, hardLine);
}
