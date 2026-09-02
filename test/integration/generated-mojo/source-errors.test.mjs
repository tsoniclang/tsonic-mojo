import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const source = [
  "function makeError(message: string): Error {",
  "  const error = new Error(message);",
  "  error.name = 'Failure';",
  "  error.message = message;",
  "  error.stack = undefined;",
  "  return error;",
  "}",
  "function fail(message: string): void { throw makeError(message); }",
  "export function main(): void {",
  "  const called = Error('called');",
  "  if (called.name === '') fail(called.message);",
  "}",
].join("\n");

for (const profile of ["native", "js"]) {
  test(`${profile} source errors retain exact construction, properties, and typed throws`, () => {
    const result = compileMojo({
      ...(profile === "js" ? { surfaces: ["js"] } : {}),
      files: { "index.ts": source },
    });
    assert.deepEqual(result.diagnostics, []);
    const generated = artifactTexts(result).find(({ text }) => text.includes("def makeError"));
    const entry = artifactTexts(result).find(({ path }) => path.endsWith("main.mojo"));
    assert.ok(generated);
    assert.ok(entry);
    assert.match(generated.text, /tsonic_runtime\.error_new/u);
    assert.match(generated.text, /\.name =/u);
    assert.match(generated.text, /\.message =/u);
    assert.match(generated.text, /\.stack =/u);
    assert.match(generated.text, /raises (?:tsonic_runtime\.TsError|Variant\[Error, tsonic_runtime\.TsError\])/u);
    assert.match(generated.text, /raise/u);
    assert.match(
      entry.text,
      /try:\s+__tsonic_entry\(\)\s+except __tsonic_entry_error:\s+raise Error\(String\(__tsonic_entry_error\)\)/u,
    );
  });
}

test("nested raising arguments are adapted through their enclosing evaluation region", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "class ParseFailure {",
        "  index: number;",
        "  constructor(index: number) { this.index = index; }",
        "}",
        "function parseAt(values: string[], index: number): unknown {",
        "  if (index < 0) throw new ParseFailure(index);",
        "  return JSON.parse(values[index]!);",
        "}",
        "export function main(): void { parseAt(['{}'], 0); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def parseAt"));
  assert.ok(generated);
  const functionStart = generated.text.indexOf("def parseAt");
  const functionEnd = generated.text.indexOf("\ndef ", functionStart + 1);
  const functionText = generated.text.slice(
    functionStart,
    functionEnd === -1 ? generated.text.length : functionEnd,
  );
  assert.match(functionText, /raises Variant\[Error, ParseFailure\]/u);
  assert.match(functionText, /tsonic_js\.json_parse\(values\[index\]\)/u);
  assert.equal((functionText.match(/\btry:/gu) ?? []).length, 1);
});

test("async binary entry converts its exact source error only at the OS boundary", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class AsyncFailure {",
        "  code: number;",
        "  constructor(code: number) { this.code = code; }",
        "}",
        "async function fail(): Promise<void> { throw new AsyncFailure(7); }",
        "export async function main(): Promise<void> { await fail(); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const entry = artifactTexts(result).find(({ path }) => path.endsWith("main.mojo"));
  assert.ok(entry);
  assert.match(
    entry.text,
    /async def __tsonic_async_entry\(\) raises:\s+try:[\s\S]*await create_raising_task\(__tsonic_entry\(\)\)[\s\S]*except __tsonic_entry_error:\s+raise Error\(String\(__tsonic_entry_error\)\)/u,
  );
  assert.match(entry.text, /create_raising_task\(__tsonic_async_entry\(\)\)\.wait\(\)/u);
});
