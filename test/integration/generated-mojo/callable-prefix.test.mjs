import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("ordinary source callbacks may ignore supplied trailing values without changing their declarations", () => {
  const result = compileMojo({ files: { "index.ts": `
function invoke(callback: (value: number, label: string) => number): number {
  return callback(7, "ignored");
}
export function prefix(): number {
  let calls = 0;
  const first = (): number => { calls += 1; return 3; };
  const second = (value: number): number => { calls += 1; return value + 2; };
  const selected: (value: number, label: string) => number = second;
  return invoke(first) + invoke(selected) + calls * 100;
}
export function contextual(): number {
  const selected: (value: number, label: string) => number = (value): number => value + 1;
  return selected(8, "ignored");
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map((entry) => entry.text).join("\n");
  assert.match(emitted, /adapt_(?:raising_)?callable_arguments/);
  assert.doesNotMatch(emitted, /MOJO_CONTEXTUAL_CALLABLE_ARITY_MISMATCH/);
});

test("source checking still rejects a callback requiring an unavailable argument", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `
export function invalid(): void {
  const callback: () => void = (value: number): void => {};
  callback();
}` } }), /TS2322/);
});
