import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface MojoRuntimeEnvironmentDependency {
  readonly name: string;
  readonly version: string;
}

export interface MojoRuntimeNativeTranslationUnit {
  readonly language: "c";
  readonly standard: "c11";
  readonly path: string;
  readonly digest: string;
  readonly text: string;
}

export interface MojoRuntimeNativePackagePlan {
  readonly digest: string;
  readonly dependencies: readonly MojoRuntimeEnvironmentDependency[];
  readonly translationUnits: readonly MojoRuntimeNativeTranslationUnit[];
  readonly includeDirectories: readonly string[];
  readonly staticLibraries: readonly string[];
  readonly dynamicLibraries: readonly string[];
}

export function analyzeMojoRuntimeNativePackage(
  importRoot: string,
  packageName: string,
): MojoRuntimeNativePackagePlan | undefined {
  const manifestPath = join(importRoot, `${packageName}.runtime.json`);
  if (!existsSync(manifestPath)) return undefined;
  requireRegularFile(manifestPath, `Mojo runtime manifest for '${packageName}'`);
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"), packageName);
  const dependencies = orderedDependencies(manifest.dependencies, packageName);
  const includeDirectories = orderedEnvironmentPaths(
    manifest.includeDirectories,
    packageName,
    "include directory",
  );
  const staticLibraries = orderedEnvironmentPaths(
    manifest.staticLibraries,
    packageName,
    "static library",
  );
  const dynamicLibraries = orderedDynamicLibraries(manifest.dynamicLibraries, packageName);
  const translationUnits = orderedTranslationUnits(
    manifest.translationUnits,
    manifestPath,
    importRoot,
    packageName,
  );
  if (translationUnits.length === 0 && staticLibraries.length === 0 &&
    dynamicLibraries.length === 0) {
    throw new Error(`Mojo runtime manifest for '${packageName}' declares no native work.`);
  }
  const contract = Object.freeze({
    contractVersion: 1,
    dependencies,
    translationUnits: translationUnits.map(({ language, standard, path, digest }) =>
      Object.freeze({ language, standard, path, digest })),
    includeDirectories,
    staticLibraries,
    dynamicLibraries,
  });
  return Object.freeze({
    digest: createHash("sha256").update(JSON.stringify(contract)).digest("hex"),
    dependencies,
    translationUnits,
    includeDirectories,
    staticLibraries,
    dynamicLibraries,
  });
}

interface RuntimeNativeManifest {
  readonly contractVersion: 1;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly translationUnits?: readonly {
    readonly language: "c";
    readonly standard: "c11";
    readonly path: string;
  }[];
  readonly includeDirectories?: readonly string[];
  readonly staticLibraries?: readonly string[];
  readonly dynamicLibraries?: readonly string[];
}

function parseManifest(text: string, packageName: string): RuntimeNativeManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Mojo runtime manifest for '${packageName}' is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isRecord(value)) {
    throw new Error(`Mojo runtime manifest for '${packageName}' must be an object.`);
  }
  requireExactFields(value, [
    "contractVersion",
    "dependencies",
    "translationUnits",
    "includeDirectories",
    "staticLibraries",
    "dynamicLibraries",
  ], `Mojo runtime manifest for '${packageName}'`);
  if (value.contractVersion !== 1) {
    throw new Error(`Mojo runtime manifest for '${packageName}' has an unsupported contract version.`);
  }
  requireOptionalStringRecord(value.dependencies, packageName, "dependencies");
  requireOptionalStringArray(value.includeDirectories, packageName, "includeDirectories");
  requireOptionalStringArray(value.staticLibraries, packageName, "staticLibraries");
  requireOptionalStringArray(value.dynamicLibraries, packageName, "dynamicLibraries");
  if (value.translationUnits !== undefined) {
    if (!Array.isArray(value.translationUnits) || value.translationUnits.length > 64) {
      throw new Error(`Mojo runtime manifest for '${packageName}' has an invalid translationUnits list.`);
    }
    for (const unit of value.translationUnits) {
      if (!isRecord(unit)) {
        throw new Error(`Mojo runtime manifest for '${packageName}' has a non-object translation unit.`);
      }
      requireExactFields(unit, ["language", "standard", "path"],
        `Mojo runtime translation unit for '${packageName}'`);
      if (unit.language !== "c" || unit.standard !== "c11" ||
        typeof unit.path !== "string") {
        throw new Error(`Mojo runtime manifest for '${packageName}' has an unsupported translation unit.`);
      }
    }
  }
  return value as unknown as RuntimeNativeManifest;
}

function orderedDependencies(
  input: Readonly<Record<string, string>> | undefined,
  packageName: string,
): readonly MojoRuntimeEnvironmentDependency[] {
  const entries = Object.entries(input ?? {});
  if (entries.length > 64) {
    throw new Error(`Mojo runtime manifest for '${packageName}' declares too many dependencies.`);
  }
  return Object.freeze(entries.map(([name, version]) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/u.test(name) ||
      !/^==[0-9A-Za-z][0-9A-Za-z._+-]*$/u.test(version)) {
      throw new Error(
        `Mojo runtime manifest for '${packageName}' has invalid exact dependency '${name}'.`,
      );
    }
    return Object.freeze({ name, version });
  }).sort((left, right) => left.name.localeCompare(right.name, "en")));
}

function orderedEnvironmentPaths(
  input: readonly string[] | undefined,
  packageName: string,
  label: string,
): readonly string[] {
  const values = input ?? [];
  if (values.length > 64) {
    throw new Error(`Mojo runtime manifest for '${packageName}' declares too many ${label}s.`);
  }
  return Object.freeze([...new Set(values.map((path) => {
    requireRelativePath(path, packageName, label);
    return path;
  }))].sort((left, right) => left.localeCompare(right, "en")));
}

function orderedDynamicLibraries(
  input: readonly string[] | undefined,
  packageName: string,
): readonly string[] {
  const values = input ?? [];
  if (values.length > 64 || values.some((value) => !/^[A-Za-z0-9_+.-]+$/u.test(value))) {
    throw new Error(`Mojo runtime manifest for '${packageName}' has invalid dynamic libraries.`);
  }
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right, "en")));
}

function orderedTranslationUnits(
  input: RuntimeNativeManifest["translationUnits"],
  manifestPath: string,
  importRoot: string,
  packageName: string,
): readonly MojoRuntimeNativeTranslationUnit[] {
  let totalBytes = 0;
  const seen = new Set<string>();
  const units = (input ?? []).map((unit) => {
    requireRelativePath(unit.path, packageName, "translation unit");
    if (!unit.path.endsWith(".c")) {
      throw new Error(`Mojo runtime translation unit '${unit.path}' is not a C source file.`);
    }
    if (seen.has(unit.path)) {
      throw new Error(`Mojo runtime translation unit '${unit.path}' is duplicated.`);
    }
    seen.add(unit.path);
    const path = resolve(dirname(manifestPath), unit.path);
    const relativePath = relative(importRoot, path).split(sep).join("/");
    if (relativePath.startsWith("../") || relativePath.split("/").includes("..")) {
      throw new Error(`Mojo runtime translation unit '${unit.path}' escapes its import root.`);
    }
    requireRegularFile(path, `Mojo runtime translation unit '${unit.path}'`);
    const bytes = readFileSync(path);
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > 67_108_864) {
      throw new Error(`Mojo runtime native sources for '${packageName}' exceed 67108864 bytes.`);
    }
    return Object.freeze({
      language: unit.language,
      standard: unit.standard,
      path: relativePath,
      digest: createHash("sha256").update(bytes).digest("hex"),
      text: utf8Decoder.decode(bytes),
    });
  });
  return Object.freeze(units.sort((left, right) => left.path.localeCompare(right.path, "en")));
}

function requireRegularFile(path: string, label: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${label} must be one regular file.`);
  }
}

function requireRelativePath(path: string, packageName: string, label: string): void {
  if (path.length === 0 || path.includes("\\") || path.startsWith("/") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9_./+-]+$/u.test(path)) {
    throw new Error(`Mojo runtime manifest for '${packageName}' has invalid ${label} path '${path}'.`);
  }
}

function requireExactFields(
  value: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  label: string,
): void {
  const allowed = new Set(fields);
  const unexpected = Object.keys(value).filter((field) => !allowed.has(field));
  if (unexpected.length !== 0) {
    throw new Error(`${label} has unsupported fields: ${unexpected.sort().join(", ")}.`);
  }
}

function requireOptionalStringRecord(
  value: unknown,
  packageName: string,
  field: string,
): void {
  if (value !== undefined && (!isRecord(value) ||
    Object.values(value).some((entry) => typeof entry !== "string"))) {
    throw new Error(`Mojo runtime manifest for '${packageName}' has an invalid ${field} object.`);
  }
}

function requireOptionalStringArray(
  value: unknown,
  packageName: string,
  field: string,
): void {
  if (value !== undefined && (!Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string"))) {
    throw new Error(`Mojo runtime manifest for '${packageName}' has an invalid ${field} list.`);
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
