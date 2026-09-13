import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("every admitted primitive formatter converts its exact UTF-16 runtime result", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
export function format(value: number, integer: int32, flag: boolean): string {
  return value.toString() + integer.toString(16) + flag.toString()
    + value.toFixed() + value.toFixed(2)
    + value.toExponential() + value.toExponential(2)
    + value.toPrecision() + value.toPrecision(3);
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).find(({ text }) => text.includes("def format("))?.text;
  assert.ok(emitted);
  assert.equal(emitted.match(/\.to_native_strict\(\)/gu)?.length, 9);
  assert.match(emitted, /raises Error -> String/u);
});
