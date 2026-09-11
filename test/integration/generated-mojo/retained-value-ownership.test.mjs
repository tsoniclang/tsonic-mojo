import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("a narrowed union return retains the selected payload instead of moving a borrowed accessor", () => {
  const result = compileMojo({ files: { "index.ts": `
class First { name = "first"; }
class Second { other = "second"; }
function select(first: boolean): First | Second { return first ? new First() : new Second(); }
function retained(): First {
  const value = select(true);
  if (!(value instanceof First)) throw new Error("wrong member");
  return value;
}
export function main(): void { if (retained().name !== "first") throw new Error("lost owner"); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(text, /return value\.unsafe_get\[First\]\(\)/u);
  assert.doesNotMatch(text, /unsafe_get\[First\]\(\)\^/u);
});

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
