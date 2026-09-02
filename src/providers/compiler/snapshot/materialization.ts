import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type {
  MojoCompilerProjectSnapshot,
  MojoCompilerToolIdentity,
} from "../model/model.js";
import { stagedSourcePath } from "./materialized-paths.js";

export function prepareMojoCompilerSnapshot(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  ephemeralRoots: Set<string>,
): string {
  const canonicalRoot = resolve(cacheRoot, "snapshots", snapshot.digest);
  if (existsSync(canonicalRoot)) {
    try {
      validateMaterializedSnapshot(canonicalRoot, snapshot);
      return canonicalRoot;
    } catch {
      const ephemeral = createMaterializedSnapshot(cacheRoot, snapshot, "leases");
      ephemeralRoots.add(ephemeral);
      return ephemeral;
    }
  }
  const staged = createMaterializedSnapshot(cacheRoot, snapshot, "staging");
  mkdirSync(dirname(canonicalRoot), { recursive: true });
  try {
    renameSync(staged, canonicalRoot);
    return canonicalRoot;
  } catch {
    if (existsSync(canonicalRoot)) {
      try {
        validateMaterializedSnapshot(canonicalRoot, snapshot);
        rmSync(staged, { recursive: true, force: true });
        return canonicalRoot;
      } catch {
        ephemeralRoots.add(staged);
        return staged;
      }
    }
    rmSync(staged, { recursive: true, force: true });
    throw new Error(`Mojo compiler snapshot '${snapshot.digest}' could not be published.`);
  }
}

export function verifyMojoCompilerExecutable(compiler: MojoCompilerToolIdentity): void {
  verifyFile(
    compiler.executablePath,
    compiler.executableByteLength,
    compiler.executableDigest,
    "snapshotted Mojo compiler executable",
  );
}

export function verifyMojoCompilerMaterializedSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  for (const package_ of snapshot.packages) {
    for (const module of package_.modules) {
      verifyFile(
        stagedSourcePath(snapshotRoot, package_, module),
        module.byteLength,
        module.digest,
        "staged Mojo source",
      );
    }
  }
}

function createMaterializedSnapshot(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  kind: "staging" | "leases",
): string {
  const root = resolve(cacheRoot, kind, `${snapshot.digest}-${process.pid}-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  try {
    materializeSnapshot(root, snapshot);
    return root;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function materializeSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  const markerPath = join(snapshotRoot, "snapshot.json");
  for (const package_ of snapshot.packages) {
    for (const module of package_.modules) {
      const destination = stagedSourcePath(snapshotRoot, package_, module);
      mkdirSync(dirname(destination), { recursive: true });
      const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
      copyFileSync(module.sourcePath, temporary);
      verifyFile(temporary, module.byteLength, module.digest, "copied Mojo source");
      renameSync(temporary, destination);
    }
  }
  verifyMojoCompilerMaterializedSnapshot(snapshotRoot, snapshot);
  const markerTemporary = `${markerPath}.${randomUUID()}.tmp`;
  writeFileSync(markerTemporary, JSON.stringify({ contractVersion: 1, digest: snapshot.digest }));
  renameSync(markerTemporary, markerPath);
}

function validateMaterializedSnapshot(
  snapshotRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
): void {
  const markerPath = join(snapshotRoot, "snapshot.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as unknown;
  if (!isSnapshotMarker(marker, snapshot.digest)) {
    throw new Error(`Mojo compiler cache marker is corrupt for snapshot '${snapshot.digest}'.`);
  }
  verifyMojoCompilerMaterializedSnapshot(snapshotRoot, snapshot);
}

function verifyFile(path: string, byteLength: number, digest: string, kind: string): void {
  const bytes = readFileSync(path);
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== byteLength || actualDigest !== digest) {
    throw new Error(`${kind} '${path}' does not match its immutable compiler snapshot.`);
  }
}

function isSnapshotMarker(value: unknown, digest: string): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (value as Record<string, unknown>).contractVersion === 1 &&
    (value as Record<string, unknown>).digest === digest &&
    Object.keys(value).length === 2;
}
