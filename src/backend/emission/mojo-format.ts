import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { TargetArtifact, TargetCompileOutput, TargetSourceFile } from "@tsonic/target-api/artifacts";
import type { MojoCompilerCommandConfiguration } from "../../target-model/configuration/model.js";

const maximumBatchFiles = 128;
const maximumBatchPathBytes = 64 * 1024;
const maximumOutputBytes = 1024 * 1024;
const maximumDiagnosticCharacters = 16 * 1024;
const formatterTimeoutMilliseconds = 120_000;

export class MojoFormattingError extends Error {
  constructor(message: string) {
    super(message.slice(0, maximumDiagnosticCharacters));
    this.name = "MojoFormattingError";
  }
}

export function formatMojoCompileOutput(
  output: TargetCompileOutput,
  command: MojoCompilerCommandConfiguration,
  requiredVersion: string,
): TargetCompileOutput {
  const sources = output.artifacts.filter(isMojoSource);
  if (sources.length === 0) return output;
  let stageRoot: string;
  try {
    stageRoot = mkdtempSync(resolve(tmpdir(), "tsonic-mojo-format-"));
  } catch (error) {
    throw formattingError("Unable to create Mojo formatter staging directory", error);
  }
  let formatted: TargetCompileOutput | undefined;
  let failure: MojoFormattingError | undefined;
  try {
    const staged = stageMojoSources(stageRoot, sources);
    const version = runCompiler(command, ["--version"], stageRoot).trim();
    if (!version.startsWith(`Mojo ${requiredVersion} `) && version !== `Mojo ${requiredVersion}`) {
      throw new MojoFormattingError(
        `Mojo formatter version '${version}' does not match required '${requiredVersion}'.`,
      );
    }
    for (const batch of formatterBatches(staged)) {
      runCompiler(command, ["format", "--quiet", "--line-length", "80", ...batch], stageRoot);
    }
    const byPath = new Map(staged.map((source) => {
      if (!lstatSync(source.absolutePath).isFile()) {
        throw new MojoFormattingError(`Formatted Mojo artifact '${source.artifactPath}' is not a regular file.`);
      }
      return [source.artifactPath, readFileSync(source.absolutePath, "utf8")] as const;
    }));
    formatted = Object.freeze({
      artifacts: Object.freeze(output.artifacts.map((artifact): TargetArtifact => {
        if (!isMojoSource(artifact)) return artifact;
        const text = byPath.get(artifact.path);
        if (text === undefined) throw new MojoFormattingError(`Missing formatted Mojo artifact '${artifact.path}'.`);
        return Object.freeze({ ...artifact, text });
      })),
    });
  } catch (error) {
    failure = error instanceof MojoFormattingError
      ? error : formattingError("Unable to format staged Mojo source", error, stageRoot);
  }
  try {
    rmSync(stageRoot, { recursive: true });
  } catch (error) {
    const cleanup = formattingError("Unable to remove Mojo formatter staging directory", error, stageRoot);
    failure = failure === undefined ? cleanup : new MojoFormattingError(`${failure.message}\n${cleanup.message}`);
  }
  if (failure !== undefined) throw failure;
  return formatted!;
}

interface StagedMojoSource {
  readonly artifactPath: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly text: string;
}

function stageMojoSources(stageRoot: string, sources: readonly TargetSourceFile[]): readonly StagedMojoSource[] {
  const paths = new Set<string>();
  const staged = sources.map((source): StagedMojoSource => {
    if (isAbsolute(source.path) || source.path.includes("\0") || source.path.includes("\\")) {
      throw new MojoFormattingError(`Generated Mojo source '${source.path}' is not a safe relative artifact path.`);
    }
    const absolutePath = resolve(stageRoot, source.path);
    const relativePath = relative(stageRoot, absolutePath);
    if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../")) {
      throw new MojoFormattingError(`Generated Mojo source '${source.path}' escapes the formatter staging root.`);
    }
    if (!relativePath.endsWith(".mojo")) {
      throw new MojoFormattingError(`Generated Mojo source '${source.path}' has no .mojo extension.`);
    }
    if (paths.has(relativePath)) throw new MojoFormattingError(`Generated Mojo source '${source.path}' occurs more than once.`);
    paths.add(relativePath);
    return Object.freeze({ artifactPath: source.path, relativePath, absolutePath, text: source.text });
  });
  for (const source of staged) {
    let separator = source.relativePath.indexOf("/");
    while (separator >= 0) {
      const ancestor = source.relativePath.slice(0, separator);
      if (paths.has(ancestor)) {
        throw new MojoFormattingError(`Generated Mojo paths '${ancestor}' and '${source.artifactPath}' conflict as a file and directory.`);
      }
      separator = source.relativePath.indexOf("/", separator + 1);
    }
  }
  for (const source of staged) {
    mkdirSync(dirname(source.absolutePath), { recursive: true });
    writeFileSync(source.absolutePath, source.text, "utf8");
  }
  return Object.freeze(staged);
}

function formatterBatches(sources: readonly StagedMojoSource[]): readonly (readonly string[])[] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const source of sources) {
    const size = Buffer.byteLength(source.absolutePath, "utf8") + 1;
    if (size > maximumBatchPathBytes) throw new MojoFormattingError(`Mojo source '${source.artifactPath}' exceeds the formatter command limit.`);
    if (batch.length === maximumBatchFiles || bytes + size > maximumBatchPathBytes) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(source.absolutePath);
    bytes += size;
  }
  if (batch.length > 0) batches.push(batch);
  return Object.freeze(batches.map((entries) => Object.freeze(entries)));
}

function runCompiler(command: MojoCompilerCommandConfiguration, arguments_: readonly string[], stageRoot: string): string {
  const result = spawnSync(command.executable, [...command.arguments, ...arguments_], {
    cwd: command.workingDirectory,
    encoding: "utf8",
    timeout: formatterTimeoutMilliseconds,
    maxBuffer: maximumOutputBytes,
    windowsHide: true,
  });
  if (result.error !== undefined) {
    throw formattingError(`Unable to execute Mojo formatter '${command.executable}'`, result.error, stageRoot);
  }
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
    throw formattingError(`Mojo formatter ${result.status === null
      ? `terminated by signal ${result.signal ?? "unknown"}`
      : `exited with status ${String(result.status)}`}`, detail, stageRoot);
  }
  return result.stdout;
}

function formattingError(message: string, error: unknown, stageRoot?: string): MojoFormattingError {
  const detail = error instanceof Error ? error.message : String(error);
  const sanitized = stageRoot === undefined ? detail : detail.split(stageRoot).join("<mojo-format-stage>");
  return new MojoFormattingError(`${message}: ${sanitized.slice(0, maximumDiagnosticCharacters)}`);
}

function isMojoSource(artifact: TargetArtifact): artifact is TargetSourceFile {
  return artifact.kind === "source" && "language" in artifact && artifact.language === "mojo";
}
