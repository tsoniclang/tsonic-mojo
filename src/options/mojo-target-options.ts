import type { TargetSelection } from "@tsonic/target-api";
import type {
  MojoOutputType,
  MojoTargetConfiguration,
} from "../target-model/project/model.js";
import { resolveMojoProjectConfiguration } from "./mojo-user-project.js";

const supportedOptionKeys = Object.freeze([
  "packageName",
  "outputType",
  "projectFile",
]);
const packageNamePattern = /^[a-z][a-z0-9_]*$/u;

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
    toolchainVersion: "1.1.0.dev2026083005",
  });
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
