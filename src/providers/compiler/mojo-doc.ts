import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type {
  MojoCompilerIdentity,
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
      prepareSnapshot(cacheRoot, options.snapshot, ephemeralSnapshotRoots);
    materializedSnapshots.set(options.snapshot.digest, snapshotRoot);
    verifyMaterializedSnapshot(snapshotRoot, options.snapshot);
    const cached = readCachedMojoPackageDocument(cacheRoot, options.snapshot, options.package);
    if (cached !== undefined) {
      const indexed = indexMojoPackageDocument(options.package, cached);
      packageDocuments.set(identity, indexed);
      return indexed;
    }
    verifyCompiler(options.snapshot.compiler);
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
      verifyMaterializedSnapshot(snapshotRoot, options.snapshot);
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
        prepareSnapshot(cacheRoot, options.snapshot, ephemeralSnapshotRoots);
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
              verifyCompiler(options.snapshot.compiler);
              verifyMaterializedSnapshot(snapshotRoot, options.snapshot);
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
            verifyCompiler(options.snapshot.compiler);
            verifyMaterializedSnapshot(snapshotRoot, options.snapshot);
          },
        }),
      });
      modules.set(identity, model);
      return model;
    },
    close(): void {
      modules.clear();
      packageDocuments.clear();
      materializedSnapshots.clear();
      for (const root of ephemeralSnapshotRoots) rmSync(root, { recursive: true, force: true });
      ephemeralSnapshotRoots.clear();
      state = "closed";
    },
  });
}

function prepareSnapshot(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  ephemeralRoots: Set<string>,
): string {
  const canonicalRoot = resolve(cacheRoot, "snapshots", snapshot.digest);
  if (existsSync(canonicalRoot)) {
    try {
      validateMaterializedSnapshot(canonicalRoot, snapshot);
      return canonicalRoot;
    } catch {
      const ephemeral = createMaterializedSnapshot(cacheRoot, snapshot, "leases");
      ephemeralRoots.add(ephemeral);
      return ephemeral;
    }
  }
  const staged = createMaterializedSnapshot(cacheRoot, snapshot, "staging");
  mkdirSync(dirname(canonicalRoot), { recursive: true });
  try {
    renameSync(staged, canonicalRoot);
    return canonicalRoot;
  } catch {
    if (existsSync(canonicalRoot)) {
      try {
        validateMaterializedSnapshot(canonicalRoot, snapshot);
        rmSync(staged, { recursive: true, force: true });
        return canonicalRoot;
      } catch {
        ephemeralRoots.add(staged);
        return staged;
      }
    }
    rmSync(staged, { recursive: true, force: true });
    throw new Error(`Mojo compiler snapshot '${snapshot.digest}' could not be published.`);
  }
}

function createMaterializedSnapshot(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  kind: "staging" | "leases",
): string {
  const root = resolve(cacheRoot, kind, `${snapshot.digest}-${process.pid}-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  try {
    materializeSnapshot(root, snapshot);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function materializeSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  const markerPath = join(snapshotRoot, "snapshot.json");
  for (const package_ of snapshot.packages) {
    for (const module of package_.modules) {
      const destination = stagedSourcePath(snapshotRoot, package_, module);
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
      copyFileSync(module.sourcePath, temporary);
      verifyFile(temporary, module.byteLength, module.digest, "copied Mojo source");
      renameSync(temporary, destination);
    }
  }
  verifyMaterializedSnapshot(snapshotRoot, snapshot);
  const markerTemporary = `${markerPath}.${randomUUID()}.tmp`;
  writeFileSync(markerTemporary, JSON.stringify({ contractVersion: 1, digest: snapshot.digest }));
  renameSync(markerTemporary, markerPath);
}

function validateMaterializedSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  const markerPath = join(snapshotRoot, "snapshot.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as unknown;
  if (!isSnapshotMarker(marker, snapshot.digest)) {
    throw new Error(`Mojo compiler cache marker is corrupt for snapshot '${snapshot.digest}'.`);
  }
  verifyMaterializedSnapshot(snapshotRoot, snapshot);
}

function verifyCompiler(compiler: MojoCompilerIdentity): void {
  verifyFile(
    compiler.executablePath,
    compiler.executableByteLength,
    compiler.executableDigest,
    "snapshotted Mojo compiler executable",
  );
}

function verifyMaterializedSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  for (const package_ of snapshot.packages) {
    for (const module of package_.modules) {
      verifyFile(
        stagedSourcePath(snapshotRoot, package_, module),
        module.byteLength,
        module.digest,
        "staged Mojo source",
      );
    }
  }
}

function stagedImportRoot(
  snapshotRoot: string,
  package_: MojoCompilerPackageSnapshot,
): string {
  return join(snapshotRoot, "imports", encodeURIComponent(package_.alias));
}

function stagedPackageRoot(
  snapshotRoot: string,
  package_: MojoCompilerPackageSnapshot,
): string {
  return join(stagedImportRoot(snapshotRoot, package_), package_.packageName);
}

function stagedSourcePath(
  snapshotRoot: string,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleSource,
): string {
  const relativeSource = relative(package_.sourceRoot, module.sourcePath);
  if (relativeSource.startsWith("..") || relativeSource.split(sep).includes("..")) {
    throw new Error(`Mojo module source '${module.sourcePath}' escapes package '${package_.id}'.`);
  }
  return join(stagedImportRoot(snapshotRoot, package_), package_.packageName, relativeSource);
}

function verifyFile(path: string, byteLength: number, digest: string, kind: string): void {
  const bytes = readFileSync(path);
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== byteLength || actualDigest !== digest) {
    throw new Error(`${kind} '${path}' does not match its immutable compiler snapshot.`);
  }
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

function isSnapshotMarker(value: unknown, digest: string): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).contractVersion === 1 &&
    (value as Record<string, unknown>).digest === digest &&
    Object.keys(value).length === 2;
}

function boundedDiagnostic(value: unknown): string {
  const text = String(value).trim();
  return text.length <= 8_192 ? text : `${text.slice(0, 8_192)}…`;
}
