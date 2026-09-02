import { join, relative, sep } from "node:path";
import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
} from "../model/model.js";

export function stagedImportRoot(
  snapshotRoot: string,
  package_: MojoCompilerPackageSnapshot,
): string {
  return join(snapshotRoot, "imports", encodeURIComponent(package_.alias));
}

export function stagedPackageRoot(
  snapshotRoot: string,
  package_: MojoCompilerPackageSnapshot,
): string {
  return join(stagedImportRoot(snapshotRoot, package_), package_.packageName);
}

export function stagedSourcePath(
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
