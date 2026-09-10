import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("owning optional union and callback tuple carriers retain borrowed payloads", () => {
  const result = compileMojo({ files: { "index.ts": `
function invoke(callback: (value: Error | undefined) => string, value: Error | undefined): string { return callback(value); }
function optional(value: Error): Error | undefined { return value; }
function union(value: Error): Error | string { return value; }
export function main(): void {
  const error = new Error("retained");
  invoke((value) => value === undefined ? "absent" : value.message, error);
  optional(error); union(error);
  error.message;
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(text, /callback.call\(\(value.copy\(\),\)\)/u);
  assert.match(text, /Optional\[TsError\]\(value.copy\(\)\)/u);
  assert.match(text, /Variant\[String, TsError\]\(value.copy\(\)\)/u);
  assert.match(text, /Optional\[TsError\]\(error.copy\(\)\)/u);
  assert.doesNotMatch(text, /Optional\[TsError\]\(error\^\)/u);
});
