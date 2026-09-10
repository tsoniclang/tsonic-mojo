import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("strict source-value equality seals symmetric boxing without primitive coercion", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function match(value: unknown): boolean { return value === "proof"; }
export function reverse(value: unknown): boolean { return "proof" === value; }
export function unequal(value: unknown): boolean { return value !== 1; }
export function effects(left: () => unknown, right: () => unknown): boolean { return left() === right(); }
export function main(): void { match("proof"); reverse("proof"); unequal("proof"); effects(() => 1, () => 1); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(text, /from tsonic_js.object import strict_equal/u);
  assert.match(text, /strict_equal\(value, js_value_from_string/u);
  assert.match(text, /strict_equal\(js_value_from_string\(JsString\("proof"\)\), value\)/u);
  assert.match(text, /not strict_equal/u);
  assert.doesNotMatch(text, /js_value_native_string\(value\)/u);
});

test("coercive erased equality is not silently treated as strict equality", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function match(value: unknown): boolean { return value == "1"; }
export function main(): void {}
` } });
  assert.deepEqual(result.artifacts, []);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_SOURCE_VALUE_COERCIVE_EQUALITY_UNSUPPORTED"));
});
