import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";

const maximumInputBytes = 1_048_576;
const maximumMessageBytes = 16_777_216;
const maximumBufferedBytes = 33_554_432;
const maximumDiagnosticBytes = 2_097_152;
const requestTimeoutMilliseconds = 120_000;
const shutdownTimeoutMilliseconds = 5_000;

interface WorkerRequestBase {
  readonly contractVersion: 1;
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly includeRoots: readonly string[];
  readonly documentUri: string;
  readonly moduleName: string;
}

interface DefinitionWorkerRequest extends WorkerRequestBase {
  readonly kind: "definitions";
  readonly exportNames: readonly string[];
}

interface CompletionWorkerRequest extends WorkerRequestBase {
  readonly kind: "exports";
}

type WorkerRequest = DefinitionWorkerRequest | CompletionWorkerRequest;

interface Position {
  readonly line: number;
  readonly character: number;
}

interface Location {
  readonly uri: string;
  readonly range: { readonly start: Position; readonly end: Position };
}

interface RpcMessage {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

async function main(): Promise<void> {
  const input = readFileSync(0);
  if (input.byteLength > maximumInputBytes) {
    throw new Error(`Mojo language-server request exceeds ${maximumInputBytes} bytes.`);
  }
  const request = parseWorkerRequest(JSON.parse(input.toString("utf8")) as unknown);
  const server = spawn(
    request.executablePath,
    [
      ...request.arguments,
      "-wait-on-shutdown",
      ...request.includeRoots.flatMap((root) => ["-I", root]),
    ],
    {
      cwd: request.workingDirectory,
      env: request.environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let diagnostic = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk: string) => {
    diagnostic = boundedAppend(diagnostic, chunk, maximumDiagnosticBytes);
  });
  const connection = createConnection(server.stdout, server.stdin);
  const timer = setTimeout(() => {
    connection.rejectAll(new Error("Mojo language-server request timed out."));
    server.kill("SIGKILL");
  }, requestTimeoutMilliseconds);
  try {
    await connection.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: { general: { positionEncodings: ["utf-16"] } },
    });
    connection.notify("initialized", {});
    const source = request.kind === "definitions"
      ? definitionSource(request)
      : completionSource(request);
    connection.notify("textDocument/didOpen", {
      textDocument: {
        uri: request.documentUri,
        languageId: "mojo",
        version: 1,
        text: source,
      },
    });
    const response = request.kind === "definitions"
      ? await resolveDefinitions(connection, request)
      : await completeExports(connection, request);
    await connection.request("shutdown", null);
    connection.notify("exit", undefined);
    await waitForExit(server);
    process.stdout.write(JSON.stringify(response));
  } catch (error) {
    server.kill("SIGKILL");
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${diagnostic.length === 0 ? "" : `\n${diagnostic}`}`);
  } finally {
    clearTimeout(timer);
  }
}

function definitionSource(request: DefinitionWorkerRequest): string {
  return `${request.exportNames.map((name, index) =>
    `from ${request.moduleName} import ${name} as __TsonicResolvedExport${index}`).join("\n")}\n`;
}

function completionSource(request: CompletionWorkerRequest): string {
  return `import ${request.moduleName} as __TsonicResolvedModule\n\ndef __tsonic_complete_exports():\n    __TsonicResolvedModule.\n`;
}

async function resolveDefinitions(
  connection: ReturnType<typeof createConnection>,
  request: DefinitionWorkerRequest,
): Promise<unknown> {
  const prefixLength = `from ${request.moduleName} import `.length;
  const definitions = await Promise.all(request.exportNames.map(async (exportName, line) => {
    const result = await connection.request("textDocument/definition", {
      textDocument: { uri: request.documentUri },
      position: { line, character: prefixLength },
    });
    return Object.freeze({ exportName, locations: parseLocations(result, exportName) });
  }));
  return Object.freeze({ contractVersion: 1, kind: "definitions", definitions });
}

async function completeExports(
  connection: ReturnType<typeof createConnection>,
  request: CompletionWorkerRequest,
): Promise<unknown> {
  const result = await connection.request("textDocument/completion", {
    textDocument: { uri: request.documentUri },
    position: { line: 3, character: "    __TsonicResolvedModule.".length },
    context: { triggerKind: 2, triggerCharacter: "." },
  });
  const record = result !== null && !Array.isArray(result)
    ? requireRecord(result, "language-server completion")
    : undefined;
  const values = Array.isArray(result)
    ? result
    : record?.items === undefined
      ? []
      : Array.isArray(record.items)
        ? record.items
        : (() => { throw new Error("Mojo language-server completion items must be an array."); })();
  const exports = values.map((value, index) => {
    const item = requireRecord(value, `language-server completion ${index}`);
    return Object.freeze({
      name: requireString(item.label, `language-server completion ${index} label`),
      kind: requireIndex(item.kind, `language-server completion ${index} kind`),
    });
  });
  return Object.freeze({ contractVersion: 1, kind: "exports", exports });
}

function createConnection(
  output: NodeJS.ReadableStream,
  input: NodeJS.WritableStream,
): {
  readonly request: (method: string, params: unknown) => Promise<unknown>;
  readonly notify: (method: string, params: unknown) => void;
  readonly rejectAll: (error: Error) => void;
} {
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map<number, PendingRequest>();
  output.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.byteLength > maximumBufferedBytes) {
      rejectAll(new Error(`Mojo language-server buffer exceeds ${maximumBufferedBytes} bytes.`));
      return;
    }
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/iu.exec(header);
      if (match === null) {
        rejectAll(new Error("Mojo language server emitted a message without Content-Length."));
        return;
      }
      const length = Number(match[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > maximumMessageBytes) {
        rejectAll(new Error(`Mojo language-server message length '${match[1]}' is invalid.`));
        return;
      }
      const bodyStart = headerEnd + 4;
      if (buffer.byteLength < bodyStart + length) return;
      const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.subarray(bodyStart + length);
      let message: RpcMessage;
      try {
        message = JSON.parse(body) as RpcMessage;
      } catch {
        rejectAll(new Error("Mojo language server emitted invalid JSON."));
        return;
      }
      if (message.id !== undefined && message.method !== undefined) {
        send({ jsonrpc: "2.0", id: message.id, result: null });
        continue;
      }
      if (message.id === undefined) continue;
      const completion = pending.get(message.id);
      if (completion === undefined) continue;
      pending.delete(message.id);
      if (message.error !== undefined) {
        completion.reject(new Error(`Mojo language-server request failed: ${JSON.stringify(message.error)}`));
      } else {
        completion.resolve(message.result);
      }
    }
  });
  output.on("error", (error) => rejectAll(error));
  output.on("end", () => rejectAll(new Error("Mojo language server closed its output.")));

  function send(message: unknown): void {
    const body = Buffer.from(JSON.stringify(message));
    input.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    input.write(body);
  }

  function request(method: string, params: unknown): Promise<unknown> {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function notify(method: string, params: unknown): void {
    send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  function rejectAll(error: Error): void {
    for (const completion of pending.values()) completion.reject(error);
    pending.clear();
  }

  return Object.freeze({ request, notify, rejectAll });
}

function parseWorkerRequest(value: unknown): WorkerRequest {
  const record = requireRecord(value, "language-server request");
  requireExactKeys(record, [
    "arguments",
    "contractVersion",
    "documentUri",
    "environment",
    "executablePath",
    "includeRoots",
    "kind",
    "moduleName",
    "workingDirectory",
    ...(record.kind === "definitions" ? ["exportNames"] : []),
  ], "language-server request");
  if (record.contractVersion !== 1) throw new Error("Unsupported Mojo language-server worker contract.");
  const environmentRecord = requireRecord(record.environment, "environment");
  const environment = Object.fromEntries(Object.entries(environmentRecord).map(([key, entry]) =>
    [key, requireText(entry, `environment.${key}`)]));
  const base = {
    contractVersion: 1,
    executablePath: requireString(record.executablePath, "executablePath"),
    arguments: Object.freeze(requireStringArray(record.arguments, "arguments")),
    workingDirectory: requireString(record.workingDirectory, "workingDirectory"),
    environment: Object.freeze(environment),
    includeRoots: Object.freeze(requireStringArray(record.includeRoots, "includeRoots")),
    documentUri: requireString(record.documentUri, "documentUri"),
    moduleName: requireModuleName(record.moduleName),
  } as const;
  if (record.kind === "definitions") {
    const exportNames = requireStringArray(record.exportNames, "exportNames");
    if (exportNames.length === 0 || new Set(exportNames).size !== exportNames.length) {
      throw new Error("Mojo language-server request requires unique exports.");
    }
    for (const name of exportNames) requireIdentifier(name, "export name");
    return Object.freeze({ ...base, kind: "definitions", exportNames: Object.freeze(exportNames) });
  }
  if (record.kind !== "exports") throw new Error("Unsupported Mojo language-server worker operation.");
  return Object.freeze({ ...base, kind: "exports" });
}

function parseLocations(value: unknown, exportName: string): readonly Location[] {
  const values = value === null ? [] : Array.isArray(value) ? value : [value];
  return Object.freeze(values.map((entry, index) => {
    const record = requireRecord(entry, `${exportName} definition ${index}`);
    requireExactKeys(record, ["range", "uri"], `${exportName} definition ${index}`);
    const range = requireRecord(record.range, `${exportName} definition ${index} range`);
    requireExactKeys(range, ["end", "start"], `${exportName} definition ${index} range`);
    return Object.freeze({
      uri: requireString(record.uri, `${exportName} definition ${index} uri`),
      range: Object.freeze({
        start: parsePosition(range.start, `${exportName} definition ${index} start`),
        end: parsePosition(range.end, `${exportName} definition ${index} end`),
      }),
    });
  }));
}

function parsePosition(value: unknown, label: string): Position {
  const record = requireRecord(value, label);
  requireExactKeys(record, ["character", "line"], label);
  return Object.freeze({
    line: requireIndex(record.line, `${label}.line`),
    character: requireIndex(record.character, `${label}.character`),
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has unsupported fields.`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be text.`);
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireModuleName(value: unknown): string {
  const name = requireString(value, "moduleName");
  if (!name.split(".").every((part) => /^[_A-Za-z][_A-Za-z0-9]*$/u.test(part))) {
    throw new Error(`Mojo module name '${name}' is invalid.`);
  }
  return name;
}

function requireIdentifier(value: string, label: string): void {
  if (!/^[_A-Za-z][_A-Za-z0-9]*$/u.test(value)) throw new Error(`Mojo ${label} '${value}' is invalid.`);
}

function requireIndex(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be an index.`);
  return Number(value);
}

function boundedAppend(current: string, addition: string, maximum: number): string {
  return current.length >= maximum ? current : `${current}${addition}`.slice(0, maximum);
}

async function waitForExit(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null) return;
  const timer = setTimeout(() => server.kill("SIGKILL"), shutdownTimeoutMilliseconds);
  try {
    await once(server, "exit");
  } finally {
    clearTimeout(timer);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
