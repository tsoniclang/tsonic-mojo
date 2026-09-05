import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("rethrows transfer an owned final-use error but retain values visible to handlers", () => {
  const result = compileMojo({ files: { "index.ts": [
    "export function rethrow(): void {",
    "  try { throw new Error('failed'); } catch (error) { throw error; }",
    "}",
    "export function observed(): void {",
    "  const error = new Error('observed');",
    "  try { throw error; } finally { error.message; }",
    "}",
    "export function caught(): void {",
    "  const error = new Error('caught');",
    "  try { throw error; } catch { error.message; }",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def rethrow"));
  assert.ok(generated);
  const rethrow = generated.text.slice(generated.text.indexOf("def rethrow"), generated.text.indexOf("def observed"));
  assert.match(rethrow, /raise error\^/u);
  const observed = generated.text.slice(generated.text.indexOf("def observed"), generated.text.indexOf("def caught"));
  assert.doesNotMatch(observed, /raise error\^/u);
  const caught = generated.text.slice(generated.text.indexOf("def caught"), generated.text.indexOf("def tsonic_main"));
  assert.doesNotMatch(caught, /raise error\^/u);
});

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
    const generated = artifactTexts(result).find(({ text }) => text.includes("def make_error"));
    const entry = artifactTexts(result).find(({ path }) => path.endsWith("main.mojo"));
    assert.ok(generated);
    assert.ok(entry);
    assert.match(generated.text, /from tsonic_runtime import[\s\S]*(?:error_new|TsError)/u);
    assert.match(generated.text, /error_new\(/u);
    assert.match(generated.text, /\.name =/u);
    assert.match(generated.text, /\.message =/u);
    assert.match(generated.text, /\.stack =/u);
    assert.match(generated.text, /raises (?:TsError|Variant\[Error, TsError\])/u);
    assert.match(generated.text, /raise/u);
    assert.match(
      entry.text,
      /try:\s+_entry\(\)\s+except _entry_error:\s+raise Error\(String\(_entry_error\)\)/u,
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
  const generated = artifactTexts(result).find(({ text }) => text.includes("def parse_at"));
  assert.ok(generated);
  const functionStart = generated.text.indexOf("def parse_at");
  const functionEnd = generated.text.indexOf("\ndef ", functionStart + 1);
  const functionText = generated.text.slice(
    functionStart,
    functionEnd === -1 ? generated.text.length : functionEnd,
  );
  assert.match(functionText, /raises Variant\[Error, ParseFailure\]/u);
  assert.match(functionText, /json_parse\(JsString\(values\[index\]\)\)/u);
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
    /async def _async_entry\(\) raises:\s+try:[\s\S]*await create_raising_task\(_entry\(\)\)[\s\S]*except _entry_error:\s+raise Error\(String\(_entry_error\)\)/u,
  );
  assert.match(entry.text, /create_raising_task\(_async_entry\(\)\)\.wait\(\)/u);
});
