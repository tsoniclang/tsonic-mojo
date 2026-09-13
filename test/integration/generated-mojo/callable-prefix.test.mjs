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
  assert.match(emitted, /lambda[\s\S]*?_callback_argument_1:[\s\S]*?Float64[\s\S]*?_callback_argument_2:[\s\S]*?String/u);
  assert.doesNotMatch(emitted, /MOJO_CONTEXTUAL_CALLABLE_ARITY_MISMATCH/);
});

test("a declared callback prefix preserves ignored argument evaluation through aliases", () => {
  const result = compileMojo({ files: { "index.ts": `
export function run(): number {
  let effects = 0;
  const callback: (value: number, label: string) => number = value => value + 1;
  const alias = callback;
  const label = (): string => { effects += 1; return "ignored"; };
  return alias(8, label()) + effects * 10;
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).filter((entry) => entry.path.startsWith("src/")).map((entry) => entry.text).join("\n");
  assert.match(emitted, /lambda/u);
  assert.match(emitted, /alias_\.call\(\(Float64\(8\), label\.call\(\(\)\)\)\)/u);
});

test("source checking still rejects a callback requiring an unavailable argument", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `
export function invalid(): void {
  const callback: () => void = (value: number): void => {};
  callback();
}` } }), /TS2322/);
});
