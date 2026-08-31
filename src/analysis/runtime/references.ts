import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { TargetRuntimeReference } from "@tsonic/target-api/artifacts";
import {
  mojoPackageNameAttribute,
  mojoPackagePathReferenceKind,
} from "../../target-model/project/runtime-reference.js";
import type { MojoRuntimePackagePlan } from "../program/model.js";

export function analyzeMojoRuntimePackages(
  references: readonly TargetRuntimeReference[],
): readonly MojoRuntimePackagePlan[] {
  const packages = new Map<string, MojoRuntimePackagePlan>();
  for (const reference of references) {
    if (reference.kind !== mojoPackagePathReferenceKind) continue;
    const name = reference.attributes?.[mojoPackageNameAttribute];
    if (name === undefined || name.length === 0 || reference.include.length === 0) {
      throw new Error("Mojo package runtime reference is missing its exact package name or path.");
    }
    const snapshot = snapshotRuntimePackage(name, reference.include);
    const existing = packages.get(name);
    if (existing !== undefined && existing.digest !== snapshot.digest) {
      throw new Error(
        `Mojo runtime package '${name}' has conflicting immutable source snapshots.`,
      );
    }
    packages.set(name, snapshot);
  }
  return Object.freeze([...packages.values()]
    .sort((left, right) => left.packageName.localeCompare(right.packageName, "en")));
}

function snapshotRuntimePackage(packageName: string, importRoot: string): MojoRuntimePackagePlan {
  if (!/^[_A-Za-z][_A-Za-z0-9]*$/u.test(packageName)) {
    throw new Error(`Mojo runtime package '${packageName}' is not a native package identifier.`);
  }
  const packageRoot = join(importRoot, packageName);
  const pending = [packageRoot];
  const files: string[] = [];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Mojo runtime package '${packageName}' contains symbolic link '${path}'.`);
      }
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && entry.name.endsWith(".mojo")) files.push(path);
    }
  }
  if (files.length === 0) {
    throw new Error(`Mojo runtime package '${packageName}' contains no Mojo sources.`);
  }
  if (files.length > maximumRuntimeSourceFiles) {
    throw new Error(`Mojo runtime package '${packageName}' exceeds ${maximumRuntimeSourceFiles} source files.`);
  }
  const sources = files.sort((left, right) => left.localeCompare(right, "en")).map((path) => {
    const bytes = readFileSync(path);
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumRuntimeSourceBytes) {
      throw new Error(`Mojo runtime package '${packageName}' exceeds ${maximumRuntimeSourceBytes} source bytes.`);
    }
    const relativePath = relative(packageRoot, path).split(sep).join("/");
    if (relativePath.startsWith("../") || relativePath.split("/").includes("..")) {
      throw new Error(`Mojo runtime source '${path}' escapes package '${packageName}'.`);
    }
    const text = utf8Decoder.decode(bytes);
    return Object.freeze({
      path: relativePath,
      digest: createHash("sha256").update(bytes).digest("hex"),
      text,
    });
  });
  return Object.freeze({
    packageName,
    digest: createHash("sha256").update(JSON.stringify(sources.map(({ path, digest }) => ({
      path,
      digest,
    })))).digest("hex"),
    sources: Object.freeze(sources),
  });
}

const maximumRuntimeSourceFiles = 100_000;
const maximumRuntimeSourceBytes = 1_073_741_824;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
