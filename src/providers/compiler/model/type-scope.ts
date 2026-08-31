import type {
  MojoCompilerGenericParameter,
  MojoCompilerPackageSnapshot,
} from "./model.js";
import type { MojoDocDocument } from "./mojo-doc-schema.js";
import type { MojoCompilerTypeScope } from "./type-parser.js";

export function createModuleScope(options: {
  readonly package: MojoCompilerPackageSnapshot;
  readonly modulePath: readonly string[];
  readonly document: MojoDocDocument;
  readonly resolveTypePath: (name: string, compilerPath?: string) => string | undefined;
}): MojoCompilerTypeScope {
  const local = new Map<string, string>();
  for (const declaration of [
    ...options.document.decl.structs,
    ...options.document.decl.traits,
    ...options.document.decl.aliases,
  ]) {
    const path = declaration.kind === "alias" && declaration.path !== undefined
      ? declaration.path
      : `/${options.package.packageName}/${[...options.modulePath, declaration.name].join("/")}`;
    local.set(declaration.name, path);
  }
  return Object.freeze({
    typeParameters: new Set<string>(),
    valueParameters: new Set<string>(),
    originParameters: new Set<string>(),
    genericTypeParameters: new Map(),
    resolveTypePath: (name: string, compilerPath?: string) =>
      local.get(name) ?? options.resolveTypePath(name, compilerPath),
  });
}

export function scopeFor(parameters: readonly MojoCompilerGenericParameter[]): MojoCompilerTypeScope {
  return {
    typeParameters: new Set(parameters.filter(({ kind }) => kind === "type").map(({ name }) => name)),
    valueParameters: new Set(parameters.filter(({ kind }) => kind === "value").map(({ name }) => name)),
    originParameters: new Set(parameters.filter(({ kind }) => kind === "origin").map(({ name }) => name)),
  };
}

export function withGenericTypeParameters(
  scope: MojoCompilerTypeScope,
  name: string,
  parameters: readonly MojoCompilerGenericParameter[],
): MojoCompilerTypeScope {
  return {
    ...scope,
    genericTypeParameters: new Map([...(scope.genericTypeParameters ?? []), [name, parameters]]),
  };
}

export function mergeScope(
  left: MojoCompilerTypeScope,
  right: MojoCompilerTypeScope,
): MojoCompilerTypeScope {
  return {
    typeParameters: new Set([...(left.typeParameters ?? []), ...(right.typeParameters ?? [])]),
    valueParameters: new Set([...(left.valueParameters ?? []), ...(right.valueParameters ?? [])]),
    originParameters: new Set([...(left.originParameters ?? []), ...(right.originParameters ?? [])]),
    genericTypeParameters: new Map([
      ...(left.genericTypeParameters ?? []),
      ...(right.genericTypeParameters ?? []),
    ]),
    resolveTypePath: right.resolveTypePath ?? left.resolveTypePath,
  };
}
