import { realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import type { MojoProjectConfiguration } from "../target-model/project/model.js";

export function resolveMojoProjectConfiguration(
  configured: string | undefined,
  projectDirectory: string,
  targetOutputRoot: string,
): MojoProjectConfiguration {
  if (configured === undefined) return Object.freeze({ kind: "generated" });
  const candidate = isAbsolute(configured)
    ? resolve(configured)
    : resolve(projectDirectory, configured);
  if (basename(candidate) !== "pixi.toml") {
    throw new Error(`Mojo target option 'projectFile' must point to pixi.toml: ${candidate}`);
  }
  let manifestPath: string;
  try {
    manifestPath = realpathSync(candidate);
  } catch {
    throw new Error(`Mojo target option 'projectFile' does not exist: ${candidate}`);
  }
  let isFile: boolean;
  try {
    isFile = statSync(manifestPath).isFile();
  } catch {
    throw new Error(`Mojo target option 'projectFile' cannot be read: ${manifestPath}`);
  }
  if (!isFile) {
    throw new Error(`Mojo target option 'projectFile' must point to a file: ${manifestPath}`);
  }
  const outputRoot = canonicalExistingPath(targetOutputRoot);
  const relativeToOutput = normalizePath(relative(outputRoot, manifestPath));
  if (relativeToOutput.length === 0 || relativeToOutput === "." ||
    (!relativeToOutput.startsWith("../") && relativeToOutput !== "..")) {
    throw new Error(
      `Mojo target option 'projectFile' must not point inside generated target output root '${targetOutputRoot}': ${manifestPath}`,
    );
  }
  return Object.freeze({ kind: "user-owned", manifestPath });
}

function canonicalExistingPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}
