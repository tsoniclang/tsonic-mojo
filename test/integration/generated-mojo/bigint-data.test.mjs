import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("closed integer data uses exact bigint boxing rather than floating-point reconstruction", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
import type { int64, uint64 } from "@tsonic/core/types.js";
import type { i64, u64 } from "@tsonic/mojo/types.js";
export function signed(value: int64): unknown { return value; }
export function unsigned(value: uint64): unknown { return value; }
export function targetSigned(value: i64): unknown { return value; }
export function targetUnsigned(value: u64): unknown { return value; }
export function main(): void {
  const value: uint64 = 9007199254740993n;
  const retained = unsigned(value);
  Object.is(retained, unsigned(value));
  console.log(retained);
  try { JSON.stringify(retained); } catch { console.log("bigint"); }
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /js_value_from_bigint\(/u);
  assert.doesNotMatch(output, /js_value_from_number\(Float64\(/u);
});
