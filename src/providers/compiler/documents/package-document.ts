import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { MojoCompilerPackageSnapshot, MojoCompilerProjectSnapshot } from "../model/model.js";
import { parseMojoDocPackageDocument } from "../model/mojo-doc-schema.js";
import type {
  MojoDocDocument,
  MojoDocPackage,
  MojoDocPackageDocument,
} from "../model/mojo-doc-schema.js";

export const maximumMojoPackageDocumentBytes = 268_435_456;

export interface IndexedMojoPackageDocument {
  readonly modules: ReadonlyMap<string, MojoDocDocument>;
  readonly declarationsByName: ReadonlyMap<string, readonly string[]>;
}

export function readCachedMojoPackageDocument(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
): MojoDocPackageDocument | undefined {
  const paths = packageCachePaths(cacheRoot, snapshot, package_);
  if (!existsSync(paths.document) || !existsSync(paths.marker)) return undefined;
  try {
    const bytes = readFileSync(paths.document);
    if (bytes.byteLength > maximumMojoPackageDocumentBytes) return undefined;
    const marker = JSON.parse(readFileSync(paths.marker, "utf8")) as unknown;
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!isPackageDocumentMarker(
      marker,
      snapshot.digest,
      package_.id,
      package_.sourceDigest,
      digest,
    )) return undefined;
    const document = parseMojoDocPackageDocument(JSON.parse(bytes.toString("utf8")) as unknown);
    return snapshot.compiler.version.includes(document.version) ? document : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedMojoPackageDocument(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
  document: unknown,
): void {
  const paths = packageCachePaths(cacheRoot, snapshot, package_);
  mkdirSync(dirname(paths.document), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(document));
  const digest = createHash("sha256").update(bytes).digest("hex");
  writeAtomically(paths.document, bytes);
  writeAtomically(paths.marker, Buffer.from(JSON.stringify({
    contractVersion: 1,
    snapshotDigest: snapshot.digest,
    packageId: package_.id,
    sourceDigest: package_.sourceDigest,
    documentDigest: digest,
  })));
}

export function indexMojoPackageDocument(
  package_: MojoCompilerPackageSnapshot,
  document: MojoDocPackageDocument,
): IndexedMojoPackageDocument {
  if (document.decl.name !== package_.packageName) {
    throw new Error(
      `Mojo package document is named '${document.decl.name}', expected '${package_.packageName}'.`,
    );
  }
  const modules = new Map<string, MojoDocDocument>();
  const declarationsByName = new Map<string, string[]>();
  const visit = (packageDocument: MojoDocPackage, prefix: readonly string[]): void => {
    for (const module of packageDocument.modules) {
      const modulePath = module.name === "__init__" ? prefix : [...prefix, module.name];
      const identity = mojoModulePathIdentity(modulePath);
      if (modules.has(identity)) {
        throw new Error(`Mojo package document contains duplicate module '${modulePath.join(".")}'.`);
      }
      modules.set(identity, Object.freeze({ version: document.version, decl: module }));
      for (const declaration of [...module.structs, ...module.traits, ...module.aliases]) {
        const path = declaration.kind === "alias" && declaration.path !== undefined
          ? declaration.path
          : `/${package_.packageName}/${[...modulePath, declaration.name].join("/")}`;
        const existing = declarationsByName.get(declaration.name) ?? [];
        if (!existing.includes(path)) existing.push(path);
        declarationsByName.set(declaration.name, existing);
      }
    }
    for (const nested of packageDocument.packages) visit(nested, [...prefix, nested.name]);
  };
  visit(document.decl, Object.freeze([]));
  const sourceModules = new Set(package_.modules.map(({ modulePath }) => mojoModulePathIdentity(modulePath)));
  const unexpected = [...modules.keys()].filter((identity) => !sourceModules.has(identity));
  if (unexpected.length > 0) {
    throw new Error(
      `Mojo package '${package_.id}' documentation contains ${unexpected.length} module(s) absent from its immutable source snapshot.`,
    );
  }
  return Object.freeze({
    modules,
    declarationsByName: new Map([...declarationsByName.entries()].map(([name, paths]) =>
      [name, Object.freeze([...paths].sort())] as const)),
  });
}

export function mojoModulePathIdentity(modulePath: readonly string[]): string {
  return modulePath.join("\0");
}

function packageCachePaths(
  cacheRoot: string,
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
): { readonly document: string; readonly marker: string } {
  const base = resolve(
    cacheRoot,
    "documents",
    snapshot.digest,
    encodeURIComponent(package_.id),
    "package",
  );
  return { document: `${base}.json`, marker: `${base}.marker.json` };
}

function writeAtomically(path: string, bytes: Uint8Array): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
}

function isPackageDocumentMarker(
  value: unknown,
  snapshotDigest: string,
  packageId: string,
  sourceDigest: string,
  documentDigest: string,
): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 5 && record.contractVersion === 1 &&
    record.snapshotDigest === snapshotDigest && record.packageId === packageId &&
    record.sourceDigest === sourceDigest && record.documentDigest === documentDigest;
}
