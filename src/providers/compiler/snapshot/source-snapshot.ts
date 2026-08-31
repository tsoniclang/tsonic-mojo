import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  MojoCompilerPackageConfiguration,
  MojoCompilerProviderConfiguration,
} from "../../../target-model/project/model.js";
import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
  MojoCompilerToolIdentity,
} from "../model/model.js";
import { mojoCompilerProviderProtocolVersion } from "../model/model.js";

const maximumSourceFiles = 100_000;
const maximumSourceBytes = 1_073_741_824;
const maximumVersionOutputBytes = 65_536;
const compilerIdentityTimeoutMilliseconds = 30_000;
const nonSemanticShellEnvironment = new Set(["_", "OLDPWD", "PWD", "SHLVL"]);

export function createMojoCompilerProjectSnapshot(
  configuration: MojoCompilerProviderConfiguration,
  requiredVersion: string,
): MojoCompilerProjectSnapshot {
  const compiler = createToolIdentity(
    configuration.command,
    ["--version"],
    "compiler",
    requiredVersion,
  );
  const languageServer = createToolIdentity(
    configuration.languageServer,
    ["--mojo-version"],
    "language server",
    requiredVersion,
  );
  const packages = configuration.packages.map(createPackageSnapshot);
  const digest = stableDigest({
    protocolVersion: mojoCompilerProviderProtocolVersion,
    compiler,
    languageServer,
    packages,
  });
  return Object.freeze({
    protocolVersion: mojoCompilerProviderProtocolVersion,
    compiler,
    languageServer,
    packages: Object.freeze(packages),
    digest,
  });
}

export function verifyMojoCompilerProjectSnapshot(
  snapshot: MojoCompilerProjectSnapshot,
  configuration: MojoCompilerProviderConfiguration,
  requiredVersion: string,
): void {
  const current = createMojoCompilerProjectSnapshot(configuration, requiredVersion);
  if (current.digest !== snapshot.digest) {
    throw new Error("Mojo compiler provider inputs changed after the compilation snapshot was created.");
  }
}

function createToolIdentity(
  configuration: MojoCompilerProviderConfiguration["command"],
  versionArguments: readonly string[],
  label: string,
  requiredVersion: string,
): MojoCompilerToolIdentity {
  const executable = resolveExecutable(
    configuration.executable,
    configuration.workingDirectory,
  );
  const executableBytes = readFileSync(executable);
  const executableDigest = createHash("sha256").update(executableBytes).digest("hex");
  const workingDirectory = realpathSync(configuration.workingDirectory);
  const arguments_ = Object.freeze([...configuration.arguments]);
  const environment = Object.freeze(Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] =>
      entry[1] !== undefined && !nonSemanticShellEnvironment.has(entry[0]))
    .sort(([left], [right]) => compareText(left, right))));
  const commandDigest = stableDigest({
    executable,
    executableByteLength: executableBytes.byteLength,
    executableDigest,
    arguments: arguments_,
    workingDirectory,
  });
  const environmentDigest = stableDigest(environment);
  const result = spawnSync(
    executable,
    [...arguments_, ...versionArguments],
    {
      cwd: workingDirectory,
      encoding: "utf8",
      env: environment,
      timeout: compilerIdentityTimeoutMilliseconds,
      maxBuffer: maximumVersionOutputBytes,
      windowsHide: true,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `Mojo ${label} identity query failed: ${boundedDiagnostic(result.error?.message ?? result.stderr ?? result.stdout)}.`,
    );
  }
  const version = String(result.stdout).trim();
  if (!version.includes(requiredVersion)) {
    throw new Error(
      `Mojo ${label} version '${version}' does not match required '${requiredVersion}'.`,
    );
  }
  return Object.freeze({
    version,
    executablePath: executable,
    executableByteLength: executableBytes.byteLength,
    executableDigest,
    arguments: arguments_,
    workingDirectory,
    environment,
    commandDigest,
    environmentDigest,
  });
}

function createPackageSnapshot(
  configuration: MojoCompilerPackageConfiguration,
): MojoCompilerPackageSnapshot {
  const sourceRoot = realpathSync(configuration.sourceRoot);
  const modules = scanPackageModules(sourceRoot);
  const sourceDigest = stableDigest(modules.map((module) => ({
    modulePath: module.modulePath,
    sourcePath: normalizeRelativePath(relative(sourceRoot, module.sourcePath)),
    byteLength: module.byteLength,
    digest: module.digest,
  })));
  return Object.freeze({
    kind: configuration.kind,
    id: configuration.id,
    alias: configuration.alias,
    packageName: configuration.packageName,
    version: configuration.version,
    importRoot: realpathSync(configuration.importRoot),
    sourceRoot,
    sourceDigest,
    modules: Object.freeze(modules),
  });
}

function scanPackageModules(sourceRoot: string): MojoCompilerModuleSource[] {
  const files: string[] = [];
  const pending = [sourceRoot];
  let totalBytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Mojo compiler package contains unsupported symbolic link '${path}'.`);
      }
      if (entry.isDirectory()) {
        pending.push(path);
      } else if (entry.isFile() && entry.name.endsWith(".mojo")) {
        files.push(path);
        if (files.length > maximumSourceFiles) {
          throw new Error(`Mojo compiler package exceeds ${maximumSourceFiles} source files.`);
        }
      }
    }
  }
  const modulesByIdentity = new Map<string, MojoCompilerModuleSource>();
  for (const path of files.sort(compareText)) {
    const bytes = readFileSync(path);
    totalBytes += bytes.byteLength;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumSourceBytes) {
      throw new Error(`Mojo compiler package exceeds ${maximumSourceBytes} source bytes.`);
    }
    const relativePath = normalizeRelativePath(relative(sourceRoot, path));
    const modulePath = modulePathFromRelativeSource(relativePath);
    const identity = modulePath.join(".");
    if (modulesByIdentity.has(identity)) {
      throw new Error(`Mojo compiler package has conflicting sources for module '${identity}'.`);
    }
    modulesByIdentity.set(identity, Object.freeze({
      modulePath: Object.freeze(modulePath),
      sourcePath: path,
      byteLength: bytes.byteLength,
      digest: createHash("sha256").update(bytes).digest("hex"),
    }));
  }
  return [...modulesByIdentity.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([, module]) => module);
}

function modulePathFromRelativeSource(relativePath: string): string[] {
  const parts = relativePath.split("/");
  const file = parts.pop()!;
  if (parts.some((part) => !isIdentifier(part))) {
    throw new Error(`Mojo package source '${relativePath}' does not map to a public module identity.`);
  }
  if (file === "__init__.mojo") return parts;
  const name = file.slice(0, -".mojo".length);
  if (!isIdentifier(name) || parts.some((part) => !isIdentifier(part))) {
    throw new Error(`Mojo package source '${relativePath}' does not map to a public module identity.`);
  }
  return [...parts, name];
}

function resolveExecutable(executable: string, workingDirectory: string): string {
  if (isAbsolute(executable) || executable.includes(sep)) {
    const path = realpathSync(resolve(workingDirectory, executable));
    if (!statSync(path).isFile()) throw new Error(`Mojo compiler executable is not a file: ${path}`);
    return path;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0) continue;
    const candidate = resolve(directory, executable);
    try {
      const path = realpathSync(candidate);
      if (statSync(path).isFile()) return path;
    } catch {
      continue;
    }
  }
  throw new Error(`Mojo compiler executable '${executable}' cannot be resolved from PATH.`);
}

function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function isIdentifier(value: string): boolean {
  return /^[_A-Za-z][_A-Za-z0-9]*$/u.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundedDiagnostic(value: unknown): string {
  const text = String(value).trim();
  return text.length <= 4_096 ? text : `${text.slice(0, 4_096)}…`;
}
