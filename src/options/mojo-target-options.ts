import type { TargetSelection } from "@tsonic/target-api";
import type {
  MojoCompilerCommandConfiguration,
  MojoCompilerPackageConfiguration,
  MojoCompilerProviderConfiguration,
  MojoTargetConfiguration,
} from "../target-model/configuration/model.js";
import type { MojoOutputType } from "../target-model/project/model.js";
import { resolveMojoProjectConfiguration } from "./mojo-user-project.js";
import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

const supportedOptionKeys = Object.freeze([
  "packageName",
  "outputType",
  "projectFile",
  "compiler",
  "providerPackages",
]);
const packageNamePattern = /^[a-z][a-z0-9_]*$/u;
const packageIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export function createMojoTargetConfiguration(
  target: TargetSelection,
  projectDirectory: string,
  targetOutputRoot: string,
): MojoTargetConfiguration {
  validateOptionKeys(target);
  return Object.freeze({
    packageName: readPackageName(target),
    outputType: readOutputType(target),
    project: resolveMojoProjectConfiguration(
      readOptionalText(target, "projectFile"),
      projectDirectory,
      targetOutputRoot,
    ),
    compilerProvider: readCompilerProvider(target, projectDirectory),
    toolchainVersion: "1.1.0.dev2026083005",
  });
}

function readCompilerProvider(
  target: TargetSelection,
  projectDirectory: string,
): MojoCompilerProviderConfiguration {
  return Object.freeze({
    command: readCompilerCommand(target.options?.compiler, projectDirectory),
    languageServer: readLanguageServerCommand(target.options?.compiler, projectDirectory),
    packages: Object.freeze(readCompilerPackages(target.options?.providerPackages, projectDirectory)),
  });
}

function readCompilerCommand(
  value: unknown,
  projectDirectory: string,
): MojoCompilerCommandConfiguration {
  if (value === undefined) {
    return Object.freeze({
      executable: "mojo",
      arguments: Object.freeze([]),
      workingDirectory: projectDirectory,
    });
  }
  const record = requireRecord(value, "options.compiler");
  requireOnlyKeys(record, [
    "executable",
    "arguments",
    "languageServerExecutable",
    "languageServerArguments",
    "workingDirectory",
  ], "options.compiler");
  const executable = requireNonEmptyText(record.executable, "options.compiler.executable");
  const arguments_ = record.arguments === undefined
    ? []
    : requireTextArray(record.arguments, "options.compiler.arguments");
  const workingDirectory = record.workingDirectory === undefined
    ? projectDirectory
    : existingDirectory(
        resolve(projectDirectory, requireNonEmptyText(
          record.workingDirectory,
          "options.compiler.workingDirectory",
        )),
        "options.compiler.workingDirectory",
      );
  return Object.freeze({
    executable,
    arguments: Object.freeze(arguments_),
    workingDirectory,
  });
}

function readLanguageServerCommand(
  value: unknown,
  projectDirectory: string,
): MojoCompilerCommandConfiguration {
  if (value === undefined) {
    return Object.freeze({
      executable: "mojo-lsp-server",
      arguments: Object.freeze([]),
      workingDirectory: projectDirectory,
    });
  }
  const record = requireRecord(value, "options.compiler");
  const executable = record.languageServerExecutable === undefined
    ? "mojo-lsp-server"
    : requireNonEmptyText(
        record.languageServerExecutable,
        "options.compiler.languageServerExecutable",
      );
  const arguments_ = record.languageServerArguments === undefined
    ? []
    : requireTextArray(
        record.languageServerArguments,
        "options.compiler.languageServerArguments",
      );
  const workingDirectory = record.workingDirectory === undefined
    ? projectDirectory
    : existingDirectory(
        resolve(projectDirectory, requireNonEmptyText(
          record.workingDirectory,
          "options.compiler.workingDirectory",
        )),
        "options.compiler.workingDirectory",
      );
  return Object.freeze({
    executable,
    arguments: Object.freeze(arguments_),
    workingDirectory,
  });
}

function readCompilerPackages(
  value: unknown,
  projectDirectory: string,
): readonly MojoCompilerPackageConfiguration[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) {
    throw new Error("Mojo target option 'providerPackages' must be an array.");
  }
  const identities = new Set<string>();
  const aliases = new Set<string>();
  const packageNames = new Set<string>();
  const packages = value.map((entry, index): MojoCompilerPackageConfiguration => {
    const field = `options.providerPackages[${index}]`;
    const record = requireRecord(entry, field);
    requireOnlyKeys(record, [
      "kind",
      "id",
      "alias",
      "packageName",
      "version",
      "importRoot",
      "sourceRoot",
    ], field);
    const kind = record.kind;
    if (kind !== "standard-library" && kind !== "package") {
      throw new Error(`Mojo target option '${field}.kind' must be 'standard-library' or 'package'.`);
    }
    const id = requireIdentity(record.id, `${field}.id`);
    const alias = requireIdentity(record.alias, `${field}.alias`);
    const packageName = requireIdentity(record.packageName, `${field}.packageName`);
    const version = requireNonEmptyText(record.version, `${field}.version`);
    const importRoot = existingDirectory(
      resolve(projectDirectory, requireNonEmptyText(record.importRoot, `${field}.importRoot`)),
      `${field}.importRoot`,
    );
    const sourceRoot = existingDirectory(
      resolve(projectDirectory, requireNonEmptyText(record.sourceRoot, `${field}.sourceRoot`)),
      `${field}.sourceRoot`,
    );
    if (realpathSync(resolve(importRoot, packageName)) !== sourceRoot) {
      throw new Error(
        `Mojo target option '${field}' must name the exact package directory '${packageName}' under its import root.`,
      );
    }
    if (identities.has(id)) throw new Error(`Mojo compiler provider package id '${id}' is duplicated.`);
    if (aliases.has(alias)) throw new Error(`Mojo compiler provider alias '${alias}' is duplicated.`);
    if (packageNames.has(packageName)) {
      throw new Error(`Mojo compiler provider native package name '${packageName}' is duplicated.`);
    }
    identities.add(id);
    aliases.add(alias);
    packageNames.add(packageName);
    return Object.freeze({ kind, id, alias, packageName, version, importRoot, sourceRoot });
  });
  const standardCount = packages.filter(({ kind }) => kind === "standard-library").length;
  if (standardCount > 1) {
    throw new Error("Mojo compiler provider accepts exactly zero or one standard-library package.");
  }
  return Object.freeze(packages);
}

function validateOptionKeys(target: TargetSelection): void {
  const allowed = new Set(supportedOptionKeys);
  for (const key of Object.keys(target.options ?? {})) {
    if (!allowed.has(key)) {
      throw new Error(`Mojo target option 'options.${key}' is not supported.`);
    }
  }
}

function readPackageName(target: TargetSelection): string {
  const value = readOptionalText(target, "packageName") ?? "tsonic_generated";
  if (!packageNamePattern.test(value)) {
    throw new Error(
      `Mojo target option 'packageName' must match ${packageNamePattern.source}.`,
    );
  }
  return value;
}

function readOutputType(target: TargetSelection): MojoOutputType {
  const value = readOptionalText(target, "outputType") ?? "bin";
  if (value !== "bin" && value !== "lib") {
    throw new Error("Mojo target option 'outputType' must be 'bin' or 'lib'.");
  }
  return value;
}

function readOptionalText(target: TargetSelection, key: string): string | undefined {
  const value = target.options?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Mojo target option '${key}' must be a non-empty string.`);
  }
  return value;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Mojo target option '${field}' must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  const allowed = new Set(keys);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) {
    throw new Error(`Mojo target option '${field}.${unsupported[0]}' is not supported.`);
  }
}

function requireNonEmptyText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Mojo target option '${field}' must be non-empty text.`);
  }
  return value;
}

function requireIdentity(value: unknown, field: string): string {
  const text = requireNonEmptyText(value, field);
  if (!packageIdentityPattern.test(text)) {
    throw new Error(`Mojo target option '${field}' must match ${packageIdentityPattern.source}.`);
  }
  return text;
}

function requireTextArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`Mojo target option '${field}' must be an array of non-empty strings.`);
  }
  return [...value] as string[];
}

function existingDirectory(path: string, field: string): string {
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    throw new Error(`Mojo target option '${field}' does not exist: ${path}`);
  }
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`Mojo target option '${field}' must name a directory: ${canonical}`);
  }
  return canonical;
}
