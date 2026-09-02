import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "../model/model.js";
import type { MojoDocDocument, MojoDocParameter } from "../model/mojo-doc-schema.js";

export function classifyMojoGenericParameterMetadata(options: {
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly parameter: MojoDocParameter;
  readonly loadDocument: (options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
  }) => MojoDocDocument;
  readonly classifyAmbiguous: () => "type" | "value" | "origin";
}): "type" | "value" | "origin" {
  const { snapshot, parameter, loadDocument } = options;
  const compilerIntrinsicCategory = intrinsicGenericParameterCategory(parameter.type);
  if (compilerIntrinsicCategory !== undefined) return compilerIntrinsicCategory;
  if (parameter.traits !== undefined) {
    if (parameter.traits.length === 0) {
      throw new Error(`Mojo generic parameter '${parameter.name}' has an empty trait constraint set.`);
    }
    for (const trait of parameter.traits) {
      if (trait.path === undefined ||
        resolveDeclaration(snapshot, trait.path, mojoNominalHead(trait.type), loadDocument).kind !== "trait") {
        throw new Error(
          `Mojo generic parameter '${parameter.name}' has a non-trait compiler constraint '${trait.path ?? trait.type}'.`,
        );
      }
    }
    return "type";
  }
  if (parameter.path === undefined) return options.classifyAmbiguous();
  const declaration = resolveDeclaration(
    snapshot,
    parameter.path,
    mojoNominalHead(parameter.type),
    loadDocument,
  );
  const { location, kind } = declaration;
  if (kind === "trait") return "type";
  if (kind === "alias") return options.classifyAmbiguous();
  if (location.package.kind === "standard-library" &&
    location.module.modulePath.length === 1 &&
    location.module.modulePath[0] === "origin" &&
    location.exportName === "Origin") {
    return "origin";
  }
  return "value";
}

export function mojoNominalHead(type: string): string {
  const name = /^[_A-Za-z][_A-Za-z0-9]*/u.exec(type.trim())?.[0];
  if (name === undefined) throw new Error(`Mojo compiler type '${type}' has no nominal declaration head.`);
  return name;
}

function intrinsicGenericParameterCategory(type: string): "value" | "origin" | undefined {
  const head = mojoNominalHead(type);
  if (head === "LITOrigin") return "origin";
  return mojoCompilerValueMetatypes.has(head) ? "value" : undefined;
}

const mojoCompilerValueMetatypes = new Set([
  "AnyStruct",
  "AnyTrait",
  "KGENParamList",
  "__generator_type",
  "__mlir_type",
  "func_type",
]);

function resolveDeclaration(
  snapshot: MojoCompilerProjectSnapshot,
  path: string,
  expectedName: string,
  loadDocument: (options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
  }) => MojoDocDocument,
): {
  readonly kind: "trait" | "struct" | "alias";
  readonly location: ReturnType<typeof declarationLocation>;
} {
  const location = declarationLocation(snapshot, path);
  const document = loadDocument({ snapshot, package: location.package, module: location.module });
  const traits = document.decl.traits.filter(({ name }) => name === expectedName);
  const structs = document.decl.structs.filter(({ name }) => name === expectedName);
  const aliases = document.decl.aliases.filter(({ name }) => name === expectedName);
  const count = traits.length + structs.length + aliases.length;
  if (count !== 1) {
    throw new Error(`Mojo declaration path '${path}' resolves to ${count} declarations named '${expectedName}'.`);
  }
  return Object.freeze({
    kind: traits.length === 1 ? "trait" : structs.length === 1 ? "struct" : "alias",
    location: Object.freeze({ ...location, exportName: expectedName }),
  });
}

function declarationLocation(
  snapshot: MojoCompilerProjectSnapshot,
  path: string,
): {
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
  readonly exportName: string;
} {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 3) {
    throw new Error(`Mojo declaration path '${path}' is not an absolute package declaration path.`);
  }
  const package_ = snapshot.packages.find(({ packageName }) => packageName === segments[0]);
  if (package_ === undefined) {
    throw new Error(`Mojo declaration path '${path}' has no configured package owner.`);
  }
  const exportName = segments[segments.length - 1]!.replace(/^#/u, "");
  const modulePath = segments.slice(1, -1);
  const module = package_.modules.find((candidate) => samePath(candidate.modulePath, modulePath));
  if (module === undefined) {
    throw new Error(`Mojo declaration path '${path}' has no exact configured module owner.`);
  }
  return { package: package_, module, exportName };
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}
