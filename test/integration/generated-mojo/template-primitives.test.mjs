import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`primitive template spelling is independent of native String storage on ${surfaces.length === 0 ? "native" : "JS"} profile`, () => {
    const result = compileMojo({ surfaces, files: {
      "index.ts": [
        'import type { float16, float32, int32 } from "@tsonic/core/types.js";',
        'export function show(value: number, flag: boolean, half: float16, single: float32, integer: int32): string {',
        '  return `${value}|${flag}|${half}|${single}|${integer}`;',
        '}',
        'export function wrapped(value: number | undefined, mixed: number | boolean): string {',
        '  return `${value}|${mixed}`;',
        '}',
        'export function main(): void {}',
      ].join("\n"),
    } });
    assert.deepEqual(result.diagnostics, []);
    const generated = artifactTexts(result).find(({ text }) => text.includes("def show("))?.text;
    assert.ok(generated);
    assert.match(generated, /source_number_to_string\(value\)/u);
    assert.match(generated, /"true" if flag else "false"/u);
    assert.match(generated, /source_number_to_string\(\s*Float64\(half\),?\s*\)/u);
    assert.match(generated, /source_number_to_string\(\s*Float64\(single\),?\s*\)/u);
    assert.doesNotMatch(generated, /String\((?:value|flag|half|single)\)/u);
    assert.doesNotMatch(generated, /JsString/u);
  });
}
