import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  requireMojoNativeDirectory,
  requireMojoNativeRelativePath,
  snapshotMojoNativeFile,
  type MojoRuntimeNativeAsset,
} from "./native-files.js";

export interface MojoRuntimeEnvironmentDependency {
  readonly name: string;
  readonly version: string;
}

export interface MojoRuntimeNativeTranslationUnit {
  readonly language: "c" | "c++";
  readonly standard: "c11" | "c++17" | "c++20";
  readonly path: string;
  readonly digest: string;
  readonly text: string;
}

export interface MojoRuntimeNativePackagePlan {
  readonly digest: string;
  readonly dependencies: readonly MojoRuntimeEnvironmentDependency[];
  readonly translationUnits: readonly MojoRuntimeNativeTranslationUnit[];
  readonly assets: readonly MojoRuntimeNativeAsset[];
  readonly includeDirectories: readonly string[];
  readonly sourceIncludeDirectories: readonly string[];
  readonly staticLibraries: readonly string[];
  readonly dynamicLibraries: readonly string[];
}

export function analyzeMojoRuntimeNativePackage(
  importRoot: string,
  packageName: string,
): MojoRuntimeNativePackagePlan | undefined {
  const manifestPath = join(importRoot, `${packageName}.runtime.json`);
  if (!existsSync(manifestPath)) return undefined;
  const manifest = parseManifest(snapshotMojoNativeFile(
    importRoot, `${packageName}.runtime.json`, 1_048_576,
  ).file.text, packageName);
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
  const { translationUnits, assets } = orderedNativeFiles(manifest, importRoot);
  const sourceIncludeDirectories = orderedEnvironmentPaths(
    manifest.sourceIncludeDirectories, packageName, "source include directory",
  );
  for (const directory of sourceIncludeDirectories) {
    requireMojoNativeDirectory(importRoot, directory.split("/"));
    if (![...translationUnits, ...assets].some((file) => file.path.startsWith(`${directory}/`))) {
      throw new Error(`Mojo runtime source include directory '${directory}' has no published files.`);
    }
  }
  if (translationUnits.length === 0 && staticLibraries.length === 0 &&
    dynamicLibraries.length === 0) {
    throw new Error(`Mojo runtime manifest for '${packageName}' declares no native work.`);
  }
  const contract = Object.freeze({
    contractVersion: 1,
    dependencies,
    translationUnits: translationUnits.map(({ language, standard, path, digest }) =>
      Object.freeze({ language, standard, path, digest })),
    assets: assets.map(({ path, digest }) => Object.freeze({ path, digest })),
    includeDirectories,
    sourceIncludeDirectories,
    staticLibraries,
    dynamicLibraries,
  });
  const digest = createHash("sha256").update(JSON.stringify(contract)).digest("hex");
  return Object.freeze({
    digest,
    dependencies,
    translationUnits: Object.freeze(translationUnits.map((unit) => Object.freeze({
      ...unit,
      digest: createHash("sha256").update(digest).update(unit.digest).digest("hex"),
    }))),
    assets,
    includeDirectories,
    sourceIncludeDirectories,
    staticLibraries,
    dynamicLibraries,
  });
}

interface RuntimeNativeManifest {
  readonly contractVersion: 1;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly translationUnits?: readonly {
    readonly language: "c" | "c++";
    readonly standard: "c11" | "c++17" | "c++20";
    readonly path: string;
  }[];
  readonly includeDirectories?: readonly string[];
  readonly sourceIncludeDirectories?: readonly string[];
  readonly assets?: readonly string[];
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
    "sourceIncludeDirectories",
    "assets",
    "staticLibraries",
    "dynamicLibraries",
  ], `Mojo runtime manifest for '${packageName}'`);
  if (value.contractVersion !== 1) {
    throw new Error(`Mojo runtime manifest for '${packageName}' has an unsupported contract version.`);
  }
  requireOptionalStringRecord(value.dependencies, packageName, "dependencies");
  requireOptionalStringArray(value.includeDirectories, packageName, "includeDirectories");
  requireOptionalStringArray(value.sourceIncludeDirectories, packageName, "sourceIncludeDirectories");
  requireOptionalStringArray(value.assets, packageName, "assets");
  if (Array.isArray(value.assets) && value.assets.length > 256) {
    throw new Error(`Mojo runtime manifest for '${packageName}' declares too many assets.`);
  }
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
      if (!((unit.language === "c" && unit.standard === "c11") ||
        (unit.language === "c++" && (unit.standard === "c++17" || unit.standard === "c++20"))) || typeof unit.path !== "string") {
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
    requireMojoNativeRelativePath(path, label);
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

function orderedNativeFiles(
  manifest: RuntimeNativeManifest,
  importRoot: string,
): {
  readonly translationUnits: readonly MojoRuntimeNativeTranslationUnit[];
  readonly assets: readonly MojoRuntimeNativeAsset[];
} {
  let remainingBytes = 67_108_864;
  const seen = new Set<string>();
  function capture(path: string): MojoRuntimeNativeAsset {
    if (seen.has(path)) throw new Error(`Mojo runtime native path '${path}' is duplicated.`);
    seen.add(path);
    const snapshot = snapshotMojoNativeFile(importRoot, path, remainingBytes);
    remainingBytes -= snapshot.byteLength;
    return snapshot.file;
  }
  const units = (manifest.translationUnits ?? []).map((unit) => {
    requireMojoNativeRelativePath(unit.path, "translation unit");
    if (!unit.path.endsWith(unit.language === "c" ? ".c" : ".cpp")) {
      throw new Error(`Mojo runtime translation unit '${unit.path}' does not match its declared language.`);
    }
    const source = capture(unit.path);
    return Object.freeze({
      language: unit.language,
      standard: unit.standard,
      path: source.path,
      digest: createHash("sha256").update(JSON.stringify({
        language: unit.language, standard: unit.standard, path: source.path,
        digest: source.digest,
      })).digest("hex"),
      text: source.text,
    });
  });
  const assets = (manifest.assets ?? []).map(capture);
  return Object.freeze({
    translationUnits: Object.freeze(units.sort((left, right) => left.path.localeCompare(right.path, "en"))),
    assets: Object.freeze(assets.sort((left, right) => left.path.localeCompare(right.path, "en"))),
  });
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
