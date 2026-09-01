import type {
  AstReader,
  Node,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import { isTsonicSourceProfileDeclarationPath } from "@tsonic/target-api/provider";
import type { SourceFileSemantics } from "@tsonic/target-api/source";
import {
  mojoJsSourceProfileOwnerId,
  mojoSourceProfileOwnerId,
} from "../../source/profiles/declarations.js";

export type MojoSourceProfileKind = "native" | "js";

export interface MojoSourceProfileTypeIdentity {
  readonly profile: MojoSourceProfileKind;
  readonly name: string;
  readonly declaration: Node;
}

export interface MojoSourceProfileRegistry {
  typeIdentity(
    symbol: Symbol | undefined,
    semantics: SourceFileSemantics,
  ): MojoSourceProfileTypeIdentity | undefined;
}

export function createMojoSourceProfileRegistry(
  sourceFiles: readonly SourceFile[],
  ast: AstReader,
  jsEnabled: boolean,
): MojoSourceProfileRegistry {
  const owners = new Map<MojoSourceProfileKind, string>();
  const ambiguous = new Set<MojoSourceProfileKind>();
  for (const sourceFile of sourceFiles) {
    const fileName = normalizeFileName(ast.getFileName(sourceFile));
    const profile = profileForFileName(fileName, jsEnabled);
    if (profile === undefined || ambiguous.has(profile)) continue;
    const existing = owners.get(profile);
    if (existing !== undefined && existing !== fileName) {
      owners.delete(profile);
      ambiguous.add(profile);
      continue;
    }
    owners.set(profile, fileName);
  }
  return Object.freeze({
    typeIdentity(symbol: Symbol | undefined, semantics: SourceFileSemantics) {
      if (symbol === undefined) return undefined;
      const matches: MojoSourceProfileTypeIdentity[] = [];
      for (const declaration of semantics.declarations.symbolDeclarations(symbol)) {
        const sourceFile = ast.getSourceFile(declaration);
        const fileName = sourceFile === undefined
          ? undefined
          : normalizeFileName(ast.getFileName(sourceFile));
        const profile = fileName === undefined ? undefined : profileForFileName(fileName, jsEnabled);
        if (profile === undefined || owners.get(profile) !== fileName) continue;
        if (!isTypeDeclaration(declaration, ast)) continue;
        const nameNode = ast.name(declaration);
        if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) continue;
        matches.push(Object.freeze({
          profile,
          name: ast.text(nameNode),
          declaration,
        }));
      }
      const distinct = new Map(matches.map((match) => [
        `${match.profile}\0${match.name}`,
        match,
      ]));
      return distinct.size === 1 ? [...distinct.values()][0] : undefined;
    },
  });
}

function profileForFileName(
  fileName: string,
  jsEnabled: boolean,
): MojoSourceProfileKind | undefined {
  const normalized = normalizeFileName(fileName);
  const nativeOwner = isTsonicSourceProfileDeclarationPath(
    normalized,
    mojoSourceProfileOwnerId,
  );
  if (!jsEnabled && nativeOwner && normalized.endsWith("/mojo-globals.d.ts")) {
    return "native";
  }
  if (jsEnabled && normalized.endsWith("/js-globals.d.ts") && (
    nativeOwner || isTsonicSourceProfileDeclarationPath(
      normalized,
      mojoJsSourceProfileOwnerId,
    )
  )) {
    return "js";
  }
  return undefined;
}

function normalizeFileName(fileName: string): string {
  return fileName.split("\\").join("/");
}

function isTypeDeclaration(node: Node, ast: AstReader): boolean {
  return ast.is.IsClassDeclaration(node) ||
    ast.is.IsInterfaceDeclaration(node) ||
    ast.is.IsTypeAliasDeclaration(node) ||
    ast.is.IsEnumDeclaration(node);
}
