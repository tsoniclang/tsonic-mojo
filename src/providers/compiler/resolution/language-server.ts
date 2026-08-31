import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "../model/model.js";
import { stagedImportRoot, stagedSourcePath } from "../snapshot/materialized-paths.js";

const resolutionTimeoutMilliseconds = 180_000;
const maximumWorkerOutputBytes = 16_777_216;

export interface MojoCompilerResolvedExport {
  readonly exportName: string;
  readonly declarationName: string;
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
}

interface WorkerLocation {
  readonly uri: string;
  readonly range: {
    readonly start: { readonly line: number; readonly character: number };
    readonly end: { readonly line: number; readonly character: number };
  };
}

export function resolveMojoCompilerExports(options: {
  readonly snapshotRoot: string;
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
  readonly exportNames: readonly string[];
}): readonly MojoCompilerResolvedExport[] {
  const exportNames = canonicalExportNames(options.exportNames);
  if (exportNames.length === 0) return Object.freeze([]);
  verifyLanguageServer(options.snapshot);
  const moduleName = [options.package.packageName, ...options.module.modulePath].join(".");
  const requestIdentity = createHash("sha256").update(JSON.stringify({
    snapshotDigest: options.snapshot.digest,
    packageId: options.package.id,
    modulePath: options.module.modulePath,
    exportNames,
  })).digest("hex");
  const response = parseWorkerResponse(runLanguageServerWorker(
    options.snapshotRoot,
    options.snapshot,
    moduleName,
    {
      kind: "definitions",
      documentUri: pathToFileURL(resolve(
        options.snapshotRoot,
        "requests",
        `resolve-${requestIdentity}.mojo`,
      )).href,
      exportNames,
    },
  ), exportNames);
  const sourceOwners = createSourceOwnerIndex(options.snapshotRoot, options.snapshot);
  return Object.freeze(response.map(({ exportName, locations }) =>
    resolveExportLocations(exportName, locations, sourceOwners)));
}

export function enumerateMojoCompilerModuleExports(options: {
  readonly snapshotRoot: string;
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
}): readonly string[] {
  if (options.module.modulePath.length === 0) {
    throw new Error(`Mojo root package '${options.package.packageName}' cannot be enumerated through a parent module.`);
  }
  const parentPath = options.module.modulePath.slice(0, -1);
  const parent = options.package.modules.find((candidate) => samePath(candidate.modulePath, parentPath));
  if (parent === undefined) {
    throw new Error(`Mojo module '${options.module.modulePath.join(".")}' has no compiler-visible parent package.`);
  }
  verifyLanguageServer(options.snapshot);
  const moduleName = [options.package.packageName, ...options.module.modulePath].join(".");
  const response = parseCompletionResponse(runLanguageServerWorker(
    options.snapshotRoot,
    options.snapshot,
    moduleName,
    {
      kind: "exports",
      documentUri: pathToFileURL(stagedSourcePath(
        options.snapshotRoot,
        options.package,
        parent,
      )).href,
      relativeModuleName: options.module.modulePath[options.module.modulePath.length - 1]!,
    },
  ));
  const names = response
    .filter(({ kind, name }) => publicCompletionKinds.has(kind) && !name.startsWith("_"))
    .map(({ name }) => name);
  return canonicalExportNames(names);
}

function runLanguageServerWorker(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  moduleName: string,
  operation: Readonly<Record<string, unknown>>,
): unknown {
  const workerPath = fileURLToPath(new URL("../lsp/worker.js", import.meta.url));
  const result = spawnSync(process.execPath, [workerPath], {
    cwd: snapshot.languageServer.workingDirectory,
    encoding: "utf8",
    input: JSON.stringify({
      contractVersion: 1,
      executablePath: snapshot.languageServer.executablePath,
      arguments: snapshot.languageServer.arguments,
      workingDirectory: snapshot.languageServer.workingDirectory,
      environment: snapshot.languageServer.environment,
      includeRoots: snapshot.packages.map((package_) => stagedImportRoot(snapshotRoot, package_)),
      moduleName,
      ...operation,
    }),
    timeout: resolutionTimeoutMilliseconds,
    maxBuffer: maximumWorkerOutputBytes,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Mojo language-server resolution failed for '${moduleName}': ${boundedDiagnostic(
        result.error?.message ?? result.stderr ?? result.stdout,
      )}`,
    );
  }
  return JSON.parse(result.stdout) as unknown;
}

function resolveExportLocations(
  exportName: string,
  locations: readonly WorkerLocation[],
  sourceOwners: ReadonlyMap<string, {
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
    readonly sourceText: string;
  }>,
): MojoCompilerResolvedExport {
  if (locations.length === 0) {
    throw new Error(`Mojo compiler module does not export '${exportName}'.`);
  }
  let resolved: MojoCompilerResolvedExport | undefined;
  for (const location of locations) {
    let sourcePath: string;
    try {
      sourcePath = resolve(fileURLToPath(location.uri));
    } catch {
      throw new Error(`Mojo definition for '${exportName}' has a non-file URI.`);
    }
    const owner = sourceOwners.get(sourcePath);
    if (owner === undefined) {
      throw new Error(`Mojo definition for '${exportName}' is outside the immutable compiler snapshot.`);
    }
    const declarationName = sourceRangeText(owner.sourceText, location, exportName);
    const candidate = Object.freeze({
      exportName,
      declarationName,
      package: owner.package,
      module: owner.module,
    });
    if (resolved !== undefined && (
      resolved.package.id !== candidate.package.id ||
      !samePath(resolved.module.modulePath, candidate.module.modulePath) ||
      resolved.declarationName !== candidate.declarationName
    )) {
      throw new Error(`Mojo export '${exportName}' resolves to multiple declaration owners.`);
    }
    resolved = candidate;
  }
  return resolved!;
}

function sourceRangeText(
  sourceText: string,
  location: WorkerLocation,
  exportName: string,
): string {
  const { start, end } = location.range;
  if (start.line !== end.line || end.character <= start.character) {
    throw new Error(`Mojo definition range for '${exportName}' is not a single identifier.`);
  }
  const lines = sourceText.split(/\r\n|\n|\r/u);
  const line = lines[start.line];
  if (line === undefined || start.character > line.length || end.character > line.length) {
    throw new Error(`Mojo definition range for '${exportName}' exceeds its source file.`);
  }
  const name = line.slice(start.character, end.character);
  if (!/^[_A-Za-z][_A-Za-z0-9]*$/u.test(name)) {
    throw new Error(`Mojo definition range for '${exportName}' does not select an identifier.`);
  }
  return name;
}

function createSourceOwnerIndex(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): ReadonlyMap<string, {
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
  readonly sourceText: string;
}> {
  const result = new Map<string, {
    readonly package: MojoCompilerPackageSnapshot;
    readonly module: MojoCompilerModuleSource;
    readonly sourceText: string;
  }>();
  for (const package_ of snapshot.packages) {
    for (const module of package_.modules) {
      const path = resolve(stagedSourcePath(snapshotRoot, package_, module));
      const sourceText = readFileSync(path, "utf8");
      const digest = createHash("sha256").update(sourceText).digest("hex");
      if (Buffer.byteLength(sourceText) !== module.byteLength || digest !== module.digest) {
        throw new Error(`Staged Mojo source '${path}' changed during semantic resolution.`);
      }
      if (result.has(path)) throw new Error(`Mojo compiler snapshot duplicates source '${path}'.`);
      result.set(path, Object.freeze({ package: package_, module, sourceText }));
    }
  }
  return result;
}

function verifyLanguageServer(snapshot: MojoCompilerProjectSnapshot): void {
  const bytes = readFileSync(snapshot.languageServer.executablePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== snapshot.languageServer.executableByteLength ||
    digest !== snapshot.languageServer.executableDigest ||
    !statSync(snapshot.languageServer.executablePath).isFile()) {
    throw new Error("Snapshotted Mojo language server changed during provider resolution.");
  }
}

function parseWorkerResponse(
  value: unknown,
  expectedExports: readonly string[],
): readonly { readonly exportName: string; readonly locations: readonly WorkerLocation[] }[] {
  const record = requireRecord(value, "language-server response");
  requireExactKeys(record, ["contractVersion", "definitions", "kind"], "language-server response");
  if (record.contractVersion !== 1 || record.kind !== "definitions" || !Array.isArray(record.definitions)) {
    throw new Error("Mojo language-server response has an unsupported contract.");
  }
  const definitions = record.definitions.map((entry, index) => {
    const definition = requireRecord(entry, `language-server definition ${index}`);
    requireExactKeys(definition, ["exportName", "locations"], `language-server definition ${index}`);
    const exportName = requireString(definition.exportName, `language-server definition ${index} name`);
    if (!Array.isArray(definition.locations)) {
      throw new Error(`Mojo language-server definition '${exportName}' has no location array.`);
    }
    return Object.freeze({
      exportName,
      locations: Object.freeze(definition.locations.map((location, locationIndex) =>
        parseLocation(location, `${exportName} location ${locationIndex}`))),
    });
  });
  if (JSON.stringify(definitions.map(({ exportName }) => exportName)) !== JSON.stringify(expectedExports)) {
    throw new Error("Mojo language-server response does not match its requested exports.");
  }
  return Object.freeze(definitions);
}

function parseCompletionResponse(
  value: unknown,
): readonly { readonly name: string; readonly kind: number }[] {
  const record = requireRecord(value, "language-server completion response");
  requireExactKeys(record, ["contractVersion", "exports", "kind"], "language-server completion response");
  if (record.contractVersion !== 1 || record.kind !== "exports" || !Array.isArray(record.exports)) {
    throw new Error("Mojo language-server completion response has an unsupported contract.");
  }
  return Object.freeze(record.exports.map((entry, index) => {
    const exported = requireRecord(entry, `language-server export ${index}`);
    requireExactKeys(exported, ["kind", "name"], `language-server export ${index}`);
    return Object.freeze({
      name: requireString(exported.name, `language-server export ${index} name`),
      kind: requireIndex(exported.kind, `language-server export ${index} kind`),
    });
  }));
}

function parseLocation(value: unknown, label: string): WorkerLocation {
  const record = requireRecord(value, label);
  requireExactKeys(record, ["range", "uri"], label);
  const range = requireRecord(record.range, `${label}.range`);
  requireExactKeys(range, ["end", "start"], `${label}.range`);
  return Object.freeze({
    uri: requireString(record.uri, `${label}.uri`),
    range: Object.freeze({
      start: parsePosition(range.start, `${label}.start`),
      end: parsePosition(range.end, `${label}.end`),
    }),
  });
}

function parsePosition(value: unknown, label: string): { readonly line: number; readonly character: number } {
  const record = requireRecord(value, label);
  requireExactKeys(record, ["character", "line"], label);
  return Object.freeze({
    line: requireIndex(record.line, `${label}.line`),
    character: requireIndex(record.character, `${label}.character`),
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has unsupported fields.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be text.`);
  return value;
}

function requireIndex(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be an index.`);
  return Number(value);
}

function canonicalExportNames(values: readonly string[]): readonly string[] {
  for (const value of values) {
    if (!/^[_A-Za-z][_A-Za-z0-9]*$/u.test(value)) {
      throw new Error(`Mojo export name '${value}' is invalid.`);
    }
  }
  return Object.freeze([...new Set(values)].sort(compareText));
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedDiagnostic(value: unknown): string {
  const text = String(value).trim();
  return text.length <= 8_192 ? text : `${text.slice(0, 8_192)}…`;
}

const publicCompletionKinds = new Set([
  3,
  5,
  6,
  7,
  8,
  10,
  12,
  13,
  20,
  21,
  22,
]);
