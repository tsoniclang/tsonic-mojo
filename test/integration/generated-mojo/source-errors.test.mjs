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
    assert.ok(generated);
    assert.match(generated.text, /tsonic_runtime\.error_new/u);
    assert.match(generated.text, /\.name =/u);
    assert.match(generated.text, /\.message =/u);
    assert.match(generated.text, /\.stack =/u);
    assert.match(generated.text, /raises (?:tsonic_runtime\.TsError|Variant\[Error, tsonic_runtime\.TsError\])/u);
    assert.match(generated.text, /raise/u);
  });
}
