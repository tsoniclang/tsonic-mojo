import type {
  AstReader,
  Node,
  ReadonlySourceFactResolver,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import { providerVirtualDeclarationFactKey } from "@tsonic/tsts";
import { jsSourceSemanticsIdentity } from "@tsonic/js-source-profile";
import { isTsonicSourceProfileDeclarationPath } from "@tsonic/target-api/provider";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
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

export interface MojoSourceProfileDeclarationIdentity {
  readonly profile: MojoSourceProfileKind;
  readonly kind: "type" | "member" | "indexer" | "call" | "construct";
  readonly declaringName?: string;
  readonly name?: string;
  readonly declaration: Node;
}

export interface MojoSourceProfileRegistry {
  profileForNode(node: Node): MojoSourceProfileKind | undefined;
  typeIdentity(
    symbol: Symbol | undefined,
    semantics: SourceFileSemantics,
  ): MojoSourceProfileTypeIdentity | undefined;
  declarationIdentity(
    declaration: Node | undefined,
    source: TargetSourceProgram,
  ): MojoSourceProfileDeclarationIdentity | undefined;
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
    profileForNode(node: Node) {
      const sourceFile = ast.getSourceFile(node);
      const fileName = sourceFile === undefined
        ? undefined
        : normalizeFileName(ast.getFileName(sourceFile));
      const profile = fileName === undefined ? undefined : profileForFileName(fileName, jsEnabled);
      return profile !== undefined && owners.get(profile) === fileName
        ? profile
        : undefined;
    },
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
    declarationIdentity(
      declaration: Node | undefined,
      source: TargetSourceProgram,
    ) {
      if (declaration === undefined) return undefined;
      const provider = jsProviderDeclarationIdentity(
        declaration,
        ast,
        source.sourceFacts,
      );
      if (provider !== undefined) return provider;
      const sourceFile = ast.getSourceFile(declaration);
      if (sourceFile === undefined || !source.semantics.includes(sourceFile)) {
        return undefined;
      }
      const fileName = sourceFile === undefined
        ? undefined
        : normalizeFileName(ast.getFileName(sourceFile));
      const profile = fileName === undefined ? undefined : profileForFileName(fileName, jsEnabled);
      if (profile === undefined || owners.get(profile) !== fileName) return undefined;
      return sourceProfileDeclarationIdentity(
        profile,
        declaration,
        ast,
        source.semantics.forFile(sourceFile),
      );
    },
  });
}

function sourceProfileDeclarationIdentity(
  profile: MojoSourceProfileKind,
  declaration: Node,
  ast: AstReader,
  semantics: SourceFileSemantics,
): MojoSourceProfileDeclarationIdentity | undefined {
  const kind = ast.kindName(declaration);
  const parent = ast.parent(declaration);
  const parentKind = parent === undefined ? undefined : ast.kindName(parent);
  if (kind === "KindFunctionDeclaration" && parentKind === "KindSourceFile") {
    const name = declarationName(declaration, ast, semantics);
    return name === undefined ? undefined : Object.freeze({
      profile,
      kind: "call",
      declaringName: "Global",
      name,
      declaration,
    });
  }
  if (sourceProfileTypeDeclarationKind(kind) && parentKind === "KindSourceFile") {
    const name = declarationName(declaration, ast, semantics);
    return name === undefined
      ? undefined
      : Object.freeze({ profile, kind: "type", name, declaration });
  }
  if (kind === "KindMappedType" && parent !== undefined && parentKind === "KindTypeAliasDeclaration") {
    const declaringName = declarationName(parent, ast, semantics);
    return declaringName === undefined
      ? undefined
      : Object.freeze({ profile, kind: "indexer", declaringName, declaration });
  }
  if (parent === undefined || !sourceProfileTypeDeclarationKind(parentKind)) return undefined;
  const declaringName = declarationName(parent, ast, semantics);
  if (declaringName === undefined) return undefined;
  if (kind === "KindIndexSignature") {
    return Object.freeze({ profile, kind: "indexer", declaringName, declaration });
  }
  if (kind === "KindCallSignature") {
    return Object.freeze({ profile, kind: "call", declaringName, declaration });
  }
  if (kind === "KindConstructSignature") {
    return Object.freeze({ profile, kind: "construct", declaringName, declaration });
  }
  if (!sourceProfileNamedMemberDeclarationKind(kind)) return undefined;
  const name = declarationName(declaration, ast, semantics);
  return name === undefined
    ? undefined
    : Object.freeze({ profile, kind: "member", declaringName, name, declaration });
}

function jsProviderDeclarationIdentity(
  declaration: Node,
  ast: AstReader,
  sourceFacts: ReadonlySourceFactResolver,
): MojoSourceProfileDeclarationIdentity | undefined {
  const fact = sourceFacts.getFact(declaration, providerVirtualDeclarationFactKey);
  if (fact?.providerId !== jsSourceSemanticsIdentity.providerId || fact.exportName === undefined) {
    return undefined;
  }
  const kind = ast.kindName(declaration);
  if (sourceProfileTypeDeclarationKind(kind)) {
    return Object.freeze({ profile: "js", kind: "type", name: fact.exportName, declaration });
  }
  if (kind === "KindIndexSignature") {
    return Object.freeze({ profile: "js", kind: "indexer", declaringName: fact.exportName, declaration });
  }
  const name = providerMemberName(fact.memberKey, fact.memberName);
  if (name === undefined) {
    return fact.signatureId === undefined
      ? undefined
      : Object.freeze({
          profile: "js",
          kind: "call",
          declaringName: fact.exportName,
          name: fact.exportName,
          declaration,
        });
  }
  return Object.freeze({
    profile: "js",
    kind: "member",
    declaringName: fact.exportName,
    name,
    declaration,
  });
}

function providerMemberName(
  memberKey: import("@tsonic/tsts").ProviderMemberKey | undefined,
  memberName: string | undefined,
): string | undefined {
  if (memberKey?.kind === "property-key") return memberKey.name;
  if (memberKey?.kind === "well-known-symbol") return `@@${memberKey.name}`;
  return memberName;
}

function declarationName(
  declaration: Node,
  ast: AstReader,
  semantics: SourceFileSemantics,
): string | undefined {
  const name = ast.name(declaration);
  if (name === undefined) return undefined;
  if (ast.is.IsComputedPropertyName(name)) {
    const selected = semantics.operations.wellKnownSymbol(name);
    return selected === undefined ? undefined : wellKnownMemberKey(selected.kind);
  }
  const kind = ast.kindName(name);
  if (kind !== "KindIdentifier" && kind !== "KindStringLiteral" &&
    kind !== "KindNumericLiteral" && kind !== "KindPrivateIdentifier") return undefined;
  const text = ast.text(name);
  return text === "" ? undefined : text;
}

function wellKnownMemberKey(
  kind: NonNullable<ReturnType<SourceFileSemantics["operations"]["wellKnownSymbol"]>>["kind"],
): string {
  switch (kind) {
    case "async-dispose": return "@@asyncDispose";
    case "async-iterator": return "@@asyncIterator";
    case "dispose": return "@@dispose";
    case "has-instance": return "@@hasInstance";
    case "is-concat-spreadable": return "@@isConcatSpreadable";
    case "iterator": return "@@iterator";
    case "match": return "@@match";
    case "match-all": return "@@matchAll";
    case "replace": return "@@replace";
    case "search": return "@@search";
    case "species": return "@@species";
    case "split": return "@@split";
    case "to-primitive": return "@@toPrimitive";
    case "to-string-tag": return "@@toStringTag";
    case "unscopables": return "@@unscopables";
  }
}

function sourceProfileTypeDeclarationKind(kind: string | undefined): boolean {
  return kind === "KindInterfaceDeclaration" || kind === "KindClassDeclaration" ||
    kind === "KindTypeAliasDeclaration" || kind === "KindEnumDeclaration";
}

function sourceProfileNamedMemberDeclarationKind(kind: string): boolean {
  return kind === "KindMethodSignature" || kind === "KindPropertySignature" ||
    kind === "KindMethodDeclaration" || kind === "KindPropertyDeclaration" ||
    kind === "KindGetAccessor" || kind === "KindSetAccessor";
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
