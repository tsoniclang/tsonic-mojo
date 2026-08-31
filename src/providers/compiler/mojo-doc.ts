import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type {
  MojoCompilerModuleModel,
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "./model/model.js";
import { parseMojoDocPackageDocument } from "./model/mojo-doc-schema.js";
import type {
  MojoDocDocument,
  MojoDocPackageDocument,
  MojoDocParameter,
} from "./model/mojo-doc-schema.js";
import { normalizeMojoDocModule } from "./model/normalization.js";
import {
  indexMojoPackageDocument,
  maximumMojoPackageDocumentBytes,
  mojoModulePathIdentity,
  readCachedMojoPackageDocument,
  writeCachedMojoPackageDocument,
} from "./documents/package-document.js";
import type { IndexedMojoPackageDocument } from "./documents/package-document.js";
import {
  classifyMojoAliasWithCompiler,
  classifyMojoGenericParameterWithCompiler,
} from "./classification/semantic-category.js";
import {
  classifyMojoGenericParameterMetadata,
  mojoNominalHead,
} from "./classification/metadata-category.js";
import {
  enumerateMojoCompilerModuleExports,
  resolveMojoCompilerExports,
} from "./resolution/language-server.js";
import type { MojoCompilerResolvedExport } from "./resolution/language-server.js";
import {
  readCachedMojoModuleExports,
  readCachedMojoResolvedExport,
  writeCachedMojoModuleExports,
  writeCachedMojoResolvedExport,
} from "./resolution/cache.js";
import {
  stagedImportRoot,
  stagedPackageRoot,
} from "./snapshot/materialized-paths.js";
import {
  prepareMojoCompilerSnapshot,
  verifyMojoCompilerExecutable,
  verifyMojoCompilerMaterializedSnapshot,
} from "./snapshot/materialization.js";

const extractionTimeoutMilliseconds = 600_000;
const maximumDiagnosticBytes = 2_097_152;

export interface MojoCompilerMetadataLoader {
  runtimeImportRoot(options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
  }): string;
  module(options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
    readonly requestedExports?: readonly string[];
  }): MojoCompilerModuleModel;
  resolveExports(options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
    readonly exportNames: readonly string[];
  }): readonly MojoCompilerResolvedExport[];
  listExports(options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
  }): readonly string[];
  close(): void;
}

export function createMojoCompilerMetadataLoader(
  cacheRoot = join(tmpdir(), "tsonic-mojo-provider"),
): MojoCompilerMetadataLoader {
  let state: "open" | "closed" = "open";
  const materializedSnapshots = new Map<string, string>();
  const ephemeralSnapshotRoots = new Set<string>();
  const modules = new Map<string, MojoCompilerModuleModel>();
  const packageDocuments = new Map<string, IndexedMojoPackageDocument>();
  const resolvedExports = new Map<string, MojoCompilerResolvedExport>();

  const loadPackageDocument = (options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
  }): IndexedMojoPackageDocument => {
    if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
    validatePackageOwnership(options.snapshot, options.package);
    const identity = packageDocumentIdentity(options.snapshot, options.package);
    const existing = packageDocuments.get(identity);
    if (existing !== undefined) return existing;
    const snapshotRoot = materializedSnapshots.get(options.snapshot.digest) ??
      prepareMojoCompilerSnapshot(cacheRoot, options.snapshot, ephemeralSnapshotRoots);
    materializedSnapshots.set(options.snapshot.digest, snapshotRoot);
    verifyMojoCompilerMaterializedSnapshot(snapshotRoot, options.snapshot);
    const cached = readCachedMojoPackageDocument(cacheRoot, options.snapshot, options.package);
    if (cached !== undefined) {
      const indexed = indexMojoPackageDocument(options.package, cached);
      packageDocuments.set(identity, indexed);
      return indexed;
    }
    verifyMojoCompilerExecutable(options.snapshot.compiler);
    const requestsRoot = resolve(cacheRoot, "requests");
    mkdirSync(requestsRoot, { recursive: true });
    const requestDirectory = mkdtempSync(resolve(requestsRoot, `${process.pid}-`));
    const outputPath = join(requestDirectory, "package.json");
    try {
      const includeArguments = options.snapshot.packages.flatMap((package_: MojoCompilerPackageSnapshot) => [
        "-I",
        stagedImportRoot(snapshotRoot, package_),
      ]);
      const result = spawnSync(
        options.snapshot.compiler.executablePath,
        [
          ...options.snapshot.compiler.arguments,
          "doc",
          stagedPackageRoot(snapshotRoot, options.package),
          "-o",
          outputPath,
          ...includeArguments,
        ],
        {
          cwd: options.snapshot.compiler.workingDirectory,
          encoding: "utf8",
          env: options.snapshot.compiler.environment,
          timeout: extractionTimeoutMilliseconds,
          maxBuffer: maximumDiagnosticBytes,
          windowsHide: true,
        },
      );
      if (result.error !== undefined || result.status !== 0) {
        throw new Error(
          `mojo doc failed for package '${options.package.id}': ${boundedDiagnostic(result.error?.message ?? result.stderr ?? result.stdout)}`,
        );
      }
      if (!existsSync(outputPath)) throw new Error("mojo doc produced no package metadata document.");
      const size = statSync(outputPath).size;
      if (!Number.isSafeInteger(size) || size > maximumMojoPackageDocumentBytes) {
        throw new Error(`mojo doc package output exceeds ${maximumMojoPackageDocumentBytes} bytes.`);
      }
      const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as unknown;
      let document: MojoDocPackageDocument;
      try {
        document = parseMojoDocPackageDocument(parsed);
      } catch (error) {
        throw new Error(
          `mojo doc schema validation failed for package '${options.package.id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!options.snapshot.compiler.version.includes(document.version)) {
        throw new Error(
          `mojo doc document version '${document.version}' differs from compiler '${options.snapshot.compiler.version}'.`,
        );
      }
      verifyMojoCompilerMaterializedSnapshot(snapshotRoot, options.snapshot);
      const indexed = indexMojoPackageDocument(options.package, document);
      writeCachedMojoPackageDocument(cacheRoot, options.snapshot, options.package, parsed);
      packageDocuments.set(identity, indexed);
      return indexed;
    } finally {
      if (existsSync(outputPath)) unlinkSync(outputPath);
      rmdirSync(requestDirectory);
    }
  };

  const loadDocument = (options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
  }): MojoDocDocument => {
    if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
    validateOwnership(options.snapshot, options.package, options.module);
    const indexed = loadPackageDocument({ snapshot: options.snapshot, package: options.package });
    const document = indexed.modules.get(mojoModulePathIdentity(options.module.modulePath));
    if (document === undefined) {
      throw new Error(
        `Mojo package '${options.package.id}' metadata has no module '${options.module.modulePath.join(".")}'.`,
      );
    }
    return document;
  };

  return Object.freeze({
    runtimeImportRoot(options: {
      readonly snapshot: MojoCompilerProjectSnapshot;
      readonly package: MojoCompilerPackageSnapshot;
    }): string {
      if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
      const exactPackage = options.snapshot.packages.find(({ id }) => id === options.package.id);
      if (exactPackage === undefined || JSON.stringify(exactPackage) !== JSON.stringify(options.package)) {
        throw new Error(
          `Mojo package '${options.package.id}' does not belong to compiler snapshot '${options.snapshot.digest}'.`,
        );
      }
      const snapshotRoot = materializedSnapshots.get(options.snapshot.digest) ??
        prepareMojoCompilerSnapshot(cacheRoot, options.snapshot, ephemeralSnapshotRoots);
      materializedSnapshots.set(options.snapshot.digest, snapshotRoot);
      return stagedImportRoot(snapshotRoot, options.package);
    },
    module(options: {
      readonly snapshot: MojoCompilerProjectSnapshot;
      readonly package: MojoCompilerPackageSnapshot;
      readonly module: MojoCompilerModuleSource;
      readonly requestedExports?: readonly string[];
    }): MojoCompilerModuleModel {
      if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
      validateOwnership(options.snapshot, options.package, options.module);
      const requestedExports = canonicalRequestedExports(options.requestedExports);
      const identity = moduleIdentity(
        options.snapshot,
        options.package,
        options.module,
        requestedExports,
      );
      const existing = modules.get(identity);
      if (existing !== undefined) return existing;
      const document = loadDocument(options);
      const snapshotRoot = materializedSnapshots.get(options.snapshot.digest);
      if (snapshotRoot === undefined) {
        throw new Error(`Mojo compiler snapshot '${options.snapshot.digest}' is not materialized.`);
      }
      const resolveTypePath = (name: string, compilerPath?: string): string | undefined => {
        const paths = new Set<string>();
        for (const candidatePackage of options.snapshot.packages) {
          const candidateDocument = loadPackageDocument({
            snapshot: options.snapshot,
            package: candidatePackage,
          });
          for (const path of candidateDocument.declarationsByName.get(name) ?? []) paths.add(path);
        }
        if (compilerPath !== undefined && paths.has(compilerPath)) return compilerPath;
        if (paths.size > 1) {
          throw new Error(`Mojo type '${name}' resolves to ${paths.size} compiler-owned declarations.`);
        }
        const resolved = paths.values().next().value as string | undefined;
        if (resolved !== undefined || compilerPath === undefined) return resolved;
        const owner = compilerPath.split("/").filter((part) => part.length > 0)[0];
        if (options.snapshot.packages.some(({ packageName }) => packageName === owner)) return compilerPath;
        throw new Error(`Mojo type path '${compilerPath}' has no configured compiler package owner.`);
      };
      const resolveParameter = (parameter: MojoDocParameter): MojoDocParameter => {
        const path = resolveTypePath(mojoNominalHead(parameter.type), parameter.path);
        const traits = parameter.traits?.map((trait) => {
          const traitPath = resolveTypePath(mojoNominalHead(trait.type), trait.path);
          return traitPath === undefined ? trait : Object.freeze({ ...trait, path: traitPath });
        });
        return Object.freeze({
          ...parameter,
          ...(path === undefined ? {} : { path }),
          ...(traits === undefined ? {} : { traits: Object.freeze(traits) }),
        });
      };
      const model = normalizeMojoDocModule({
        package: options.package,
        modulePath: options.module.modulePath,
        sourceDigest: options.module.digest,
        document,
        ...(requestedExports === undefined ? {} : { requestedExports }),
        resolveTypePath,
        classifyGenericParameter: (request) => classifyMojoGenericParameterMetadata({
          snapshot: options.snapshot,
          parameter: resolveParameter(request.parameter),
          loadDocument,
          classifyAmbiguous: () => classifyMojoGenericParameterWithCompiler({
            cacheRoot,
            snapshot: options.snapshot,
            package: options.package,
            module: options.module,
            parameter: resolveParameter(request.parameter),
            parentParameters: request.parentParameters.map(resolveParameter),
            precedingParameters: request.precedingParameters.map(resolveParameter),
            includeRoots: options.snapshot.packages.map((package_) =>
              stagedImportRoot(snapshotRoot, package_)),
            verifySnapshot: () => {
              verifyMojoCompilerExecutable(options.snapshot.compiler);
              verifyMojoCompilerMaterializedSnapshot(snapshotRoot, options.snapshot);
            },
          }),
        }),
        classifyAlias: (request) => classifyMojoAliasWithCompiler({
          cacheRoot,
          snapshot: options.snapshot,
          package: options.package,
          module: options.module,
          alias: request.declaration,
          genericParameters: request.genericParameters,
          ...(request.owner === undefined ? {} : { owner: request.owner }),
          includeRoots: options.snapshot.packages.map((package_) =>
            stagedImportRoot(snapshotRoot, package_)),
          verifySnapshot: () => {
            verifyMojoCompilerExecutable(options.snapshot.compiler);
            verifyMojoCompilerMaterializedSnapshot(snapshotRoot, options.snapshot);
          },
        }),
      });
      modules.set(identity, model);
      return model;
    },
    resolveExports(options: {
      readonly snapshot: MojoCompilerProjectSnapshot;
      readonly package: MojoCompilerPackageSnapshot;
      readonly module: MojoCompilerModuleSource;
      readonly exportNames: readonly string[];
    }): readonly MojoCompilerResolvedExport[] {
      if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
      validateOwnership(options.snapshot, options.package, options.module);
      const exportNames = canonicalRequestedExports(options.exportNames) ?? Object.freeze([]);
      const indexed = loadPackageDocument({ snapshot: options.snapshot, package: options.package });
      const direct = indexed.exportsByModule.get(mojoModulePathIdentity(options.module.modulePath));
      if (direct === undefined) {
        throw new Error(`Mojo package metadata has no module '${options.module.modulePath.join(".")}'.`);
      }
      const unresolved: string[] = [];
      for (const exportName of exportNames) {
        const identity = resolvedExportIdentity(
          options.snapshot,
          options.package,
          options.module,
          exportName,
        );
        if (resolvedExports.has(identity)) continue;
        if (direct.has(exportName)) {
          resolvedExports.set(identity, Object.freeze({
            exportName,
            declarationName: exportName,
            package: options.package,
            module: options.module,
          }));
        } else {
          const cached = readCachedMojoResolvedExport(
            cacheRoot,
            options.snapshot,
            options.package,
            options.module,
            exportName,
          );
          if (cached === undefined) unresolved.push(exportName);
          else resolvedExports.set(identity, cached);
        }
      }
      if (unresolved.length > 0) {
        const snapshotRoot = materializedSnapshots.get(options.snapshot.digest);
        if (snapshotRoot === undefined) {
          throw new Error(`Mojo compiler snapshot '${options.snapshot.digest}' is not materialized.`);
        }
        for (const resolved of resolveMojoCompilerExports({
          snapshotRoot,
          snapshot: options.snapshot,
          package: options.package,
          module: options.module,
          exportNames: unresolved,
        })) {
          writeCachedMojoResolvedExport(
            cacheRoot,
            options.snapshot,
            options.package,
            options.module,
            resolved,
          );
          resolvedExports.set(resolvedExportIdentity(
            options.snapshot,
            options.package,
            options.module,
            resolved.exportName,
          ), resolved);
        }
      }
      return Object.freeze(exportNames.map((exportName) => {
        const resolved = resolvedExports.get(resolvedExportIdentity(
          options.snapshot,
          options.package,
          options.module,
          exportName,
        ));
        if (resolved === undefined) throw new Error(`Mojo export '${exportName}' was not resolved.`);
        return resolved;
      }));
    },
    listExports(options: {
      readonly snapshot: MojoCompilerProjectSnapshot;
      readonly package: MojoCompilerPackageSnapshot;
      readonly module: MojoCompilerModuleSource;
    }): readonly string[] {
      if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
      validateOwnership(options.snapshot, options.package, options.module);
      const indexed = loadPackageDocument({ snapshot: options.snapshot, package: options.package });
      const direct = indexed.exportsByModule.get(mojoModulePathIdentity(options.module.modulePath));
      if (direct === undefined) {
        throw new Error(`Mojo package metadata has no module '${options.module.modulePath.join(".")}'.`);
      }
      const cached = readCachedMojoModuleExports(
        cacheRoot,
        options.snapshot,
        options.package,
        options.module,
      );
      if (cached !== undefined) {
        return Object.freeze([...new Set([...direct, ...cached])].sort(compareText));
      }
      const snapshotRoot = materializedSnapshots.get(options.snapshot.digest);
      if (snapshotRoot === undefined) {
        throw new Error(`Mojo compiler snapshot '${options.snapshot.digest}' is not materialized.`);
      }
      const discovered = enumerateMojoCompilerModuleExports({
        snapshotRoot,
        snapshot: options.snapshot,
        package: options.package,
        module: options.module,
      });
      writeCachedMojoModuleExports(
        cacheRoot,
        options.snapshot,
        options.package,
        options.module,
        discovered,
      );
      return Object.freeze([...new Set([...direct, ...discovered])].sort(compareText));
    },
    close(): void {
      modules.clear();
      packageDocuments.clear();
      resolvedExports.clear();
      materializedSnapshots.clear();
      for (const root of ephemeralSnapshotRoots) rmSync(root, { recursive: true, force: true });
      ephemeralSnapshotRoots.clear();
      state = "closed";
    },
  });
}

function validateOwnership(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleSource,
): void {
  const exactPackage = snapshot.packages.find((candidate) => candidate.id === package_.id);
  if (exactPackage === undefined || JSON.stringify(exactPackage) !== JSON.stringify(package_)) {
    throw new Error(`Mojo package '${package_.id}' does not belong to compiler snapshot '${snapshot.digest}'.`);
  }
  const exactModule = exactPackage.modules.find((candidate) =>
    candidate.modulePath.join("\0") === module.modulePath.join("\0"));
  if (exactModule === undefined || JSON.stringify(exactModule) !== JSON.stringify(module)) {
    throw new Error(`Mojo module '${module.modulePath.join(".")}' does not belong to package '${package_.id}'.`);
  }
}

function validatePackageOwnership(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
): void {
  const exactPackage = snapshot.packages.find((candidate) => candidate.id === package_.id);
  if (exactPackage === undefined || JSON.stringify(exactPackage) !== JSON.stringify(package_)) {
    throw new Error(`Mojo package '${package_.id}' does not belong to compiler snapshot '${snapshot.digest}'.`);
  }
}

function moduleIdentity(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleSource,
  requestedExports?: readonly string[],
): string {
  return `${snapshot.digest}\0${package_.id}\0${module.modulePath.join(".")}\0${
    requestedExports === undefined ? "*" : requestedExports.join("\0")
  }`;
}

function canonicalRequestedExports(exports: readonly string[] | undefined): readonly string[] | undefined {
  return exports === undefined
    ? undefined
    : Object.freeze([...new Set(exports)].sort(compareText));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageDocumentIdentity(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
): string {
  return `${snapshot.digest}\0${package_.id}`;
}

function resolvedExportIdentity(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleSource,
  exportName: string,
): string {
  return `${snapshot.digest}\0${package_.id}\0${module.modulePath.join(".")}\0${exportName}`;
}

function boundedDiagnostic(value: unknown): string {
  const text = String(value).trim();
  return text.length <= 8_192 ? text : `${text.slice(0, 8_192)}…`;
}
