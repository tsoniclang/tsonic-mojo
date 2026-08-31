import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { MojoCompilerProviderConfiguration } from "../../target-model/project/model.js";
import type {
  MojoCompilerModuleModel,
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "./model/model.js";
import { parseMojoDocDocument } from "./model/mojo-doc-schema.js";
import { normalizeMojoDocModule } from "./model/normalization.js";

const extractionTimeoutMilliseconds = 600_000;
const maximumDiagnosticBytes = 2_097_152;
const maximumDocumentBytes = 268_435_456;

export interface MojoCompilerMetadataLoader {
  module(options: {
    readonly snapshot: MojoCompilerProjectSnapshot;
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
  }): MojoCompilerModuleModel;
  close(): void;
}

export function createMojoCompilerMetadataLoader(
  configuration: MojoCompilerProviderConfiguration,
  cacheRoot = join(tmpdir(), "tsonic-mojo-provider"),
): MojoCompilerMetadataLoader {
  let state: "open" | "closed" = "open";
  const materializedSnapshots = new Set<string>();
  const modules = new Map<string, MojoCompilerModuleModel>();
  return Object.freeze({
    module(options: {
      readonly snapshot: MojoCompilerProjectSnapshot;
      readonly package: MojoCompilerPackageSnapshot;
      readonly module: MojoCompilerModuleSource;
    }): MojoCompilerModuleModel {
      if (state === "closed") throw new Error("Mojo compiler metadata loader is closed.");
      validateOwnership(options.snapshot, options.package, options.module);
      const identity = `${options.snapshot.digest}\0${options.package.id}\0${options.module.modulePath.join(".")}`;
      const existing = modules.get(identity);
      if (existing !== undefined) return existing;
      const snapshotRoot = resolve(cacheRoot, "snapshots", options.snapshot.digest);
      if (!materializedSnapshots.has(options.snapshot.digest)) {
        materializeSnapshot(snapshotRoot, options.snapshot);
        materializedSnapshots.add(options.snapshot.digest);
      }
      const sourcePath = stagedSourcePath(snapshotRoot, options.package, options.module);
      verifyFile(sourcePath, options.module.byteLength, options.module.digest, "staged Mojo source");
      const requestsRoot = resolve(cacheRoot, "requests");
      mkdirSync(requestsRoot, { recursive: true });
      const requestDirectory = mkdtempSync(resolve(requestsRoot, `${process.pid}-`));
      const outputPath = join(requestDirectory, "module.json");
      try {
        const includeArguments = options.snapshot.packages.flatMap((package_: MojoCompilerPackageSnapshot) => [
          "-I",
          stagedImportRoot(snapshotRoot, package_),
        ]);
        const result = spawnSync(
          configuration.command.executable,
          [
            ...configuration.command.arguments,
            "doc",
            sourcePath,
            "-o",
            outputPath,
            ...includeArguments,
          ],
          {
            cwd: configuration.command.workingDirectory,
            encoding: "utf8",
            env: process.env,
            timeout: extractionTimeoutMilliseconds,
            maxBuffer: maximumDiagnosticBytes,
            windowsHide: true,
          },
        );
        if (result.error !== undefined || result.status !== 0) {
          throw new Error(
            `mojo doc failed for package '${options.package.id}' module '${options.module.modulePath.join(".")}': ${boundedDiagnostic(result.error?.message ?? result.stderr ?? result.stdout)}`,
          );
        }
        if (!existsSync(outputPath)) throw new Error("mojo doc produced no metadata document.");
        const size = statSync(outputPath).size;
        if (!Number.isSafeInteger(size) || size > maximumDocumentBytes) {
          throw new Error(`mojo doc output exceeds ${maximumDocumentBytes} bytes.`);
        }
        const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as unknown;
        const document = parseMojoDocDocument(parsed);
        if (!options.snapshot.compiler.version.includes(document.version)) {
          throw new Error(
            `mojo doc document version '${document.version}' differs from compiler '${options.snapshot.compiler.version}'.`,
          );
        }
        verifyFile(sourcePath, options.module.byteLength, options.module.digest, "staged Mojo source");
        const model = normalizeMojoDocModule({
          package: options.package,
          modulePath: options.module.modulePath,
          sourceDigest: options.module.digest,
          document,
        });
        modules.set(identity, model);
        return model;
      } finally {
        if (existsSync(outputPath)) unlinkSync(outputPath);
        rmdirSync(requestDirectory);
      }
    },
    close(): void {
      modules.clear();
      materializedSnapshots.clear();
      state = "closed";
    },
  });
}

function materializeSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  const markerPath = join(snapshotRoot, "snapshot.json");
  if (existsSync(markerPath)) {
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as unknown;
    if (!isSnapshotMarker(marker, snapshot.digest)) {
      throw new Error(`Mojo compiler cache marker is corrupt for snapshot '${snapshot.digest}'.`);
    }
    verifyMaterializedSnapshot(snapshotRoot, snapshot);
    return;
  }
  mkdirSync(snapshotRoot, { recursive: true });
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
