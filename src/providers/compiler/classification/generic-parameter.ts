import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "../model/model.js";
import type { MojoDocParameter } from "../model/mojo-doc-schema.js";

export type MojoGenericParameterCategory = "type" | "value" | "origin";

const classificationTimeoutMilliseconds = 60_000;
const maximumDiagnosticBytes = 1_048_576;

export function classifyMojoGenericParameterWithCompiler(options: {
  readonly cacheRoot: string;
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
  readonly parameter: MojoDocParameter;
  readonly parentParameters: readonly MojoDocParameter[];
  readonly precedingParameters: readonly MojoDocParameter[];
  readonly verifySnapshot: () => void;
  readonly includeRoots: readonly string[];
}): MojoGenericParameterCategory {
  const key = classificationKey(options);
  const cached = readCachedClassification(options.cacheRoot, options.snapshot.digest, key);
  if (cached !== undefined) return classificationResult(cached);
  options.verifySnapshot();
  const requestRoot = resolve(options.cacheRoot, "requests");
  mkdirSync(requestRoot, { recursive: true });
  const requestDirectory = mkdtempSync(resolve(requestRoot, `${process.pid}-classification-`));
  try {
    const workspace = materializeClassificationWorkspace(options, requestDirectory);
    const sourcePrefix = readFileSync(workspace.moduleSourcePath, "utf8");
    const probes = Object.freeze([
      Object.freeze({
        category: "type" as const,
        source: classificationSource(options, sourcePrefix, "type"),
      }),
      Object.freeze({
        category: "origin" as const,
        source: classificationSource(options, sourcePrefix, "origin"),
      }),
      Object.freeze({
        category: "value" as const,
        source: classificationSource(options, sourcePrefix, "value"),
      }),
    ]);
    const diagnostics: string[] = [];
    for (const probe of probes) {
      const result = executeProbe(
        options,
        requestDirectory,
        workspace.moduleSourcePath,
        workspace.includeRoots,
        probe.category,
        probe.source,
      );
      if (result.accepted) {
        options.verifySnapshot();
        const classified = Object.freeze({ kind: "classified" as const, category: probe.category });
        writeCachedClassification(options.cacheRoot, options.snapshot.digest, key, classified);
        return probe.category;
      }
      diagnostics.push(`${probe.category}: ${result.diagnostic}`);
    }
    options.verifySnapshot();
    const diagnostic = boundedDiagnostic(diagnostics.join("\n"));
    const rejected = Object.freeze({ kind: "rejected" as const, diagnostic });
    writeCachedClassification(options.cacheRoot, options.snapshot.digest, key, rejected);
    throw new Error(diagnostic);
  } finally {
    rmSync(requestDirectory, { recursive: true, force: true });
  }
}

type CachedClassification =
  | { readonly kind: "classified"; readonly category: MojoGenericParameterCategory }
  | { readonly kind: "rejected"; readonly diagnostic: string };

function executeProbe(
  options: Parameters<typeof classifyMojoGenericParameterWithCompiler>[0],
  requestDirectory: string,
  sourcePath: string,
  includeRoots: readonly string[],
  category: MojoGenericParameterCategory,
  source: string,
): { readonly accepted: true } | { readonly accepted: false; readonly diagnostic: string } {
  const outputPath = join(requestDirectory, `${category}.json`);
  writeFileSync(sourcePath, source);
  try {
    const includeArguments = includeRoots.flatMap((root) => ["-I", root]);
    const result = spawnSync(
      options.snapshot.compiler.executablePath,
      [
        ...options.snapshot.compiler.arguments,
        "doc",
        sourcePath,
        "-o",
        outputPath,
        ...includeArguments,
      ],
      {
        cwd: options.snapshot.compiler.workingDirectory,
        encoding: "utf8",
        env: options.snapshot.compiler.environment,
        timeout: classificationTimeoutMilliseconds,
        maxBuffer: maximumDiagnosticBytes,
        windowsHide: true,
      },
    );
    if (result.error === undefined && result.status === 0 && existsSync(outputPath)) {
      return Object.freeze({ accepted: true });
    }
    return Object.freeze({
      accepted: false,
      diagnostic: boundedDiagnostic(
        String(result.error?.message ?? result.stderr ?? result.stdout)
          .split(requestDirectory).join("<classification-workspace>"),
      ),
    });
  } finally {
    if (existsSync(outputPath)) unlinkSync(outputPath);
  }
}

function materializeClassificationWorkspace(
  options: Parameters<typeof classifyMojoGenericParameterWithCompiler>[0],
  requestDirectory: string,
): { readonly moduleSourcePath: string; readonly includeRoots: readonly string[] } {
  if (options.includeRoots.length !== options.snapshot.packages.length) {
    throw new Error("Mojo classification package roots do not match the immutable compiler snapshot.");
  }
  const workspaceRoot = join(requestDirectory, "imports");
  const includeRoots: string[] = [];
  let moduleSourcePath: string | undefined;
  for (const [packageIndex, package_] of options.snapshot.packages.entries()) {
    const sourceImportRoot = options.includeRoots[packageIndex]!;
    const destinationImportRoot = join(workspaceRoot, encodeURIComponent(package_.alias));
    includeRoots.push(destinationImportRoot);
    for (const module of package_.modules) {
      const relativeSource = relative(package_.sourceRoot, module.sourcePath);
      if (relativeSource.startsWith("..") || relativeSource.split(sep).includes("..")) {
        throw new Error(`Mojo module source '${module.sourcePath}' escapes package '${package_.id}'.`);
      }
      const source = join(sourceImportRoot, package_.packageName, relativeSource);
      const destination = join(destinationImportRoot, package_.packageName, relativeSource);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      if (package_.id === options.package.id && sameModule(module, options.module)) {
        moduleSourcePath = destination;
      }
    }
  }
  if (moduleSourcePath === undefined) {
    throw new Error(`Mojo classification module '${options.module.modulePath.join(".")}' was not materialized.`);
  }
  return Object.freeze({ moduleSourcePath, includeRoots: Object.freeze(includeRoots) });
}

function classificationSource(
  options: Parameters<typeof classifyMojoGenericParameterWithCompiler>[0],
  moduleSource: string,
  category: MojoGenericParameterCategory,
): string {
  const key = classificationKey(options).slice(0, 20);
  const memberName = `__tsonic_classify_${category}_${key}`;
  const memberParameters = renderParameterClause([
    ...options.parentParameters,
    ...options.precedingParameters,
    Object.freeze({ ...options.parameter, name: "__TsonicCandidate" }),
  ]);
  const body = category === "type"
    ? "    var __tsonic_value: __TsonicCandidate\n"
    : category === "origin"
      ? "    var __tsonic_value: Pointer[Int, __TsonicCandidate]\n"
      : "    comptime __tsonic_value = __TsonicCandidate\n";
  return `${moduleSource}\n\nfrom std.memory import Pointer\n\n` +
    `def ${memberName}${memberParameters}():\n${body}`;
}

function renderParameterClause(parameters: readonly MojoDocParameter[]): string {
  if (parameters.length === 0) return "";
  return `[${parameters.map((parameter) => `${parameter.name}: ${parameter.type}`).join(", ")}]`;
}

function classificationKey(
  options: Parameters<typeof classifyMojoGenericParameterWithCompiler>[0],
): string {
  return createHash("sha256").update(JSON.stringify({
    contractVersion: 3,
    snapshotDigest: options.snapshot.digest,
    packageId: options.package.id,
    modulePath: options.module.modulePath,
    parentParameters: options.parentParameters,
    precedingParameters: options.precedingParameters,
    name: options.parameter.name,
    type: options.parameter.type,
    path: options.parameter.path,
  })).digest("hex");
}

function readCachedClassification(
  cacheRoot: string,
  snapshotDigest: string,
  key: string,
): CachedClassification | undefined {
  const path = classificationPath(cacheRoot, snapshotDigest, key);
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || record.contractVersion !== 1 || record.key !== key) return undefined;
    const result = record.result;
    if (result === null || typeof result !== "object" || Array.isArray(result)) return undefined;
    const candidate = result as Record<string, unknown>;
    if (candidate.kind === "classified" && Object.keys(candidate).length === 2 &&
      (candidate.category === "type" || candidate.category === "value" || candidate.category === "origin")) {
      return Object.freeze({ kind: "classified", category: candidate.category });
    }
    if (candidate.kind === "rejected" && Object.keys(candidate).length === 2 &&
      typeof candidate.diagnostic === "string") {
      return Object.freeze({ kind: "rejected", diagnostic: candidate.diagnostic });
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeCachedClassification(
  cacheRoot: string,
  snapshotDigest: string,
  key: string,
  result: CachedClassification,
): void {
  const path = classificationPath(cacheRoot, snapshotDigest, key);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify({ contractVersion: 1, key, result }));
  renameSync(temporary, path);
}

function classificationPath(cacheRoot: string, snapshotDigest: string, key: string): string {
  return resolve(cacheRoot, "classifications", snapshotDigest, `${key}.json`);
}

function classificationResult(result: CachedClassification): MojoGenericParameterCategory {
  if (result.kind === "classified") return result.category;
  throw new Error(result.diagnostic);
}

function sameModule(left: MojoCompilerModuleSource, right: MojoCompilerModuleSource): boolean {
  return left.digest === right.digest && left.modulePath.length === right.modulePath.length &&
    left.modulePath.every((part, index) => part === right.modulePath[index]);
}

function boundedDiagnostic(value: unknown): string {
  const text = String(value).trim();
  const diagnostic = text.length === 0
    ? "the Mojo compiler rejected the probe without a diagnostic"
    : text;
  return diagnostic.length <= 8_192 ? diagnostic : `${diagnostic.slice(0, 8_192)}…`;
}
