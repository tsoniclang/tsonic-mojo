import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--mojo-version") {
  process.stdout.write("Mojo 1.1.0.dev2026083005 (fixture)\n");
  process.exit(0);
}

const includeIndex = args.lastIndexOf("-I");
if (includeIndex < 0 || args[includeIndex + 1] === undefined) {
  process.stderr.write("fake Mojo language server requires an include root\n");
  process.exit(2);
}
const sourcePath = join(args[includeIndex + 1], "probe", "api.mojo");
let buffer = Buffer.alloc(0);
let openedText = "";
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("ascii");
    const match = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/iu.exec(header);
    if (match === null) process.exit(3);
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.byteLength < bodyStart + length) return;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString("utf8"));
    buffer = buffer.subarray(bodyStart + length);
    handle(message);
  }
});

function handle(message) {
  if (message.method === "textDocument/didOpen") {
    openedText = String(message.params.textDocument.text);
    return;
  }
  if (message.method === "initialize") {
    respond(message.id, { capabilities: { completionProvider: {}, definitionProvider: true } });
    return;
  }
  if (message.method === "shutdown") {
    respond(message.id, null);
    return;
  }
  if (message.method === "exit") {
    process.exit(0);
  }
  if (message.method === "textDocument/completion") {
    respond(message.id, [
      { label: "BrokenAlias", kind: 7 },
      { label: "Counter", kind: 22 },
      { label: "sum", kind: 3 },
    ]);
    return;
  }
  if (message.method !== "textDocument/definition") return;
  const line = Number(message.params.position.line);
  const text = openedText.split("\n")[line] ?? "";
  const imported = /\bimport\s+([_A-Za-z][_A-Za-z0-9]*)\s+as\b/u.exec(text)?.[1];
  if (imported !== "PublicCounter") {
    respond(message.id, []);
    return;
  }
  const sourceLines = readFileSync(sourcePath, "utf8").split("\n");
  const sourceLine = sourceLines.findIndex((entry) => entry.includes("struct Counter"));
  const character = sourceLines[sourceLine].indexOf("Counter");
  respond(message.id, [{
    uri: pathToFileURL(sourcePath).href,
    range: {
      start: { line: sourceLine, character },
      end: { line: sourceLine, character: character + "Counter".length },
    },
  }]);
}

function respond(id, result) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }));
  process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
  process.stdout.write(body);
}
