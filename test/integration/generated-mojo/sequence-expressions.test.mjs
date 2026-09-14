import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo, projectArtifactTexts } from "../../helpers/mojo-session.mjs";

test("sequence operands keep their distinct carriers and source order", () => {
  const result = compileMojo({ files: { "index.ts": `
let trace = "";
function record(value: string): string { trace += value; return value; }
export function compute(flag: boolean): number {
  let count = 0;
  const value = (record("a"), count++, (record("b"), count + 3));
  const condition = flag && (record("c"), value === 4);
  return condition ? value : count;
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.ok(text.indexOf('record("a")') < text.indexOf('record("b")'));
  assert.match(text, /if .*:\s+_ = record\("c"\)/u);
});
