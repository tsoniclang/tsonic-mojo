import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";

export interface MojoRuntimeNativeAsset {
  readonly path: string;
  readonly digest: string;
  readonly text: string;
}

export interface MojoRuntimeNativeFileSnapshot {
  readonly file: MojoRuntimeNativeAsset;
  readonly byteLength: number;
}

export function snapshotMojoNativeFile(
  root: string,
  path: string,
  budget: number,
): MojoRuntimeNativeFileSnapshot {
  requireMojoNativeRelativePath(path, "native file");
  requireMojoNativeDirectory(root, path.split("/").slice(0, -1));
  const absolute = join(root, path);
  if (!lstatSync(absolute).isFile()) {
    throw new Error(`Mojo runtime native file '${path}' must be one regular file.`);
  }
  const descriptor = openSync(absolute, "r");
  try {
    const before = fstatSync(descriptor);
    if (!Number.isSafeInteger(before.size) || before.size > budget) {
      throw new Error(`Mojo runtime native file '${path}' exceeds the remaining source byte budget.`);
    }
    const bytes = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(descriptor, bytes, offset, bytes.byteLength - offset, offset);
      if (count === 0) throw new Error(`Mojo runtime native file '${path}' changed during capture.`);
      offset += count;
    }
    const after = fstatSync(descriptor);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs) {
      throw new Error(`Mojo runtime native file '${path}' changed during capture.`);
    }
    return Object.freeze({
      byteLength: bytes.byteLength,
      file: Object.freeze({
        path,
        digest: createHash("sha256").update(path).update("\0").update(bytes).digest("hex"),
        text: utf8Decoder.decode(bytes),
      }),
    });
  } finally {
    closeSync(descriptor);
  }
}

export function requireMojoNativeDirectory(root: string, segments: readonly string[]): void {
  let directory = root;
  for (const segment of segments) {
    directory = join(directory, segment);
    if (!lstatSync(directory).isDirectory()) {
      throw new Error(`Mojo runtime native directory '${segments.join("/")}' must contain no symlinks.`);
    }
  }
}

export function requireMojoNativeRelativePath(path: string, label: string): void {
  if (path.length === 0 || path.includes("\\") || path.startsWith("/") ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    !/^[A-Za-z0-9_./+-]+$/u.test(path)) {
    throw new Error(`Mojo runtime manifest has invalid ${label} path '${path}'.`);
  }
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
