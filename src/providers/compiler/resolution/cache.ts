import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "../model/model.js";
import type { MojoCompilerResolvedExport } from "./language-server.js";

const cacheContractVersion = 1;
const maximumCacheRecordBytes = 1_048_576;

export function readCachedMojoResolvedExport(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  sourcePackage: MojoCompilerPackageSnapshot,
  sourceModule: MojoCompilerModuleSource,
  exportName: string,
): MojoCompilerResolvedExport | undefined {
  const record = readRecord(cachePath(
    cacheRoot,
    "exports",
    snapshot,
    sourcePackage,
    sourceModule,
    exportName,
  ));
  if (record === undefined || !hasExactKeys(record, [
    "contractVersion",
    "declarationName",
    "exportName",
    "ownerModuleDigest",
    "ownerModulePath",
    "ownerPackageId",
    "snapshotDigest",
    "sourceModuleDigest",
    "sourceModulePath",
    "sourcePackageId",
  ])) return undefined;
  if (record.contractVersion !== cacheContractVersion ||
    record.snapshotDigest !== snapshot.digest ||
    record.sourcePackageId !== sourcePackage.id ||
    record.sourceModuleDigest !== sourceModule.digest ||
    !samePath(record.sourceModulePath, sourceModule.modulePath) ||
    record.exportName !== exportName ||
    !isIdentifier(record.declarationName) ||
    typeof record.ownerPackageId !== "string" ||
    typeof record.ownerModuleDigest !== "string" ||
    !isStringArray(record.ownerModulePath)) return undefined;
  const ownerModulePath = record.ownerModulePath;
  const ownerPackage = snapshot.packages.find(({ id }) => id === record.ownerPackageId);
  const ownerModule = ownerPackage?.modules.find(({ modulePath }) =>
    samePath(modulePath, ownerModulePath));
  if (ownerPackage === undefined || ownerModule === undefined ||
    ownerModule.digest !== record.ownerModuleDigest) return undefined;
  return Object.freeze({
    exportName,
    declarationName: record.declarationName,
    package: ownerPackage,
    module: ownerModule,
  });
}

export function writeCachedMojoResolvedExport(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  sourcePackage: MojoCompilerPackageSnapshot,
  sourceModule: MojoCompilerModuleSource,
  resolved: MojoCompilerResolvedExport,
): void {
  writeRecord(cachePath(
    cacheRoot,
    "exports",
    snapshot,
    sourcePackage,
    sourceModule,
    resolved.exportName,
  ), {
    contractVersion: cacheContractVersion,
    snapshotDigest: snapshot.digest,
    sourcePackageId: sourcePackage.id,
    sourceModulePath: sourceModule.modulePath,
    sourceModuleDigest: sourceModule.digest,
    exportName: resolved.exportName,
    ownerPackageId: resolved.package.id,
    ownerModulePath: resolved.module.modulePath,
    ownerModuleDigest: resolved.module.digest,
    declarationName: resolved.declarationName,
  });
}

export function readCachedMojoModuleExports(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  sourcePackage: MojoCompilerPackageSnapshot,
  sourceModule: MojoCompilerModuleSource,
): readonly string[] | undefined {
  const record = readRecord(cachePath(
    cacheRoot,
    "module-exports",
    snapshot,
    sourcePackage,
    sourceModule,
  ));
  if (record === undefined || !hasExactKeys(record, [
    "contractVersion",
    "exportNames",
    "snapshotDigest",
    "sourceModuleDigest",
    "sourceModulePath",
    "sourcePackageId",
  ])) return undefined;
  if (record.contractVersion !== cacheContractVersion ||
    record.snapshotDigest !== snapshot.digest ||
    record.sourcePackageId !== sourcePackage.id ||
    record.sourceModuleDigest !== sourceModule.digest ||
    !samePath(record.sourceModulePath, sourceModule.modulePath) ||
    !isStringArray(record.exportNames) ||
    record.exportNames.some((name) => !isIdentifier(name))) return undefined;
  const canonical = canonicalNames(record.exportNames);
  return JSON.stringify(canonical) === JSON.stringify(record.exportNames) ? canonical : undefined;
}

export function writeCachedMojoModuleExports(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  sourcePackage: MojoCompilerPackageSnapshot,
  sourceModule: MojoCompilerModuleSource,
  exportNames: readonly string[],
): void {
  const canonical = canonicalNames(exportNames);
  writeRecord(cachePath(
    cacheRoot,
    "module-exports",
    snapshot,
    sourcePackage,
    sourceModule,
  ), {
    contractVersion: cacheContractVersion,
    snapshotDigest: snapshot.digest,
    sourcePackageId: sourcePackage.id,
    sourceModulePath: sourceModule.modulePath,
    sourceModuleDigest: sourceModule.digest,
    exportNames: canonical,
  });
}

function cachePath(
  cacheRoot: string,
  kind: "exports" | "module-exports",
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  module: MojoCompilerModuleSource,
  exportName?: string,
): string {
  const identity = createHash("sha256").update(JSON.stringify({
    snapshotDigest: snapshot.digest,
    packageId: package_.id,
    modulePath: module.modulePath,
    ...(exportName === undefined ? {} : { exportName }),
  })).digest("hex");
  return resolve(cacheRoot, "resolutions", kind, snapshot.digest, `${identity}.json`);
}

function readRecord(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const bytes = readFileSync(path);
    if (bytes.byteLength > maximumCacheRecordBytes) return undefined;
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function writeRecord(path: string, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.byteLength > maximumCacheRecordBytes) {
    throw new Error(`Mojo compiler resolution cache record exceeds ${maximumCacheRecordBytes} bytes.`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function samePath(value: unknown, expected: readonly string[]): value is readonly string[] {
  return isStringArray(value) && JSON.stringify(value) === JSON.stringify(expected);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[_A-Za-z][_A-Za-z0-9]*$/u.test(value);
}

function canonicalNames(names: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(names)].sort(compareText));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
