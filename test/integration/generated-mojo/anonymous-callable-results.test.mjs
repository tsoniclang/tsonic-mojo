import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("returned anonymous and aliased closures use the retained result ABI", () => {
  const result = compileMojo({ files: { "index.ts": `
export function direct(value: number): () => number { return () => value + 1; }
export function aliased(value: number): () => number {
  const selected = () => value + 2;
  return selected;
}
export function nested(value: number): () => () => number {
  return () => () => value + 3;
}
export function main(): void { direct(1)(); aliased(2)(); nested(3)()(); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /allocate_callable_environment/u);
  assert.match(emitted, /return Callable/u);
  assert.doesNotMatch(emitted, /return _closure\b/u);
});

test("nested closures retain transitive bindings and read enclosing capture fields", () => {
  const result = compileMojo({ files: { "index.ts": `
export function factory(seed: number): () => () => number {
  let count = seed;
  return () => () => { count += 1; return count; };
}
export function immediate(seed: number): () => number {
  return () => { const read = () => seed + 1; return read(); };
}
export function shadow(seed: number): () => (seed: number) => number {
  return () => (seed: number) => seed + 1;
}
export function main(): void { factory(1)()(); immediate(1)(); shadow(1)()(2); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /Location\[Float64\]/u);
  assert.match(emitted, /_pointer\[\]\.\w+/u);
  assert.match(emitted, /ref \w*capture\w* =/u);
});

test("returned callback uses adapt finalized error effects at their declared result boundary", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function stringify(value: unknown): string { return \`\${value}\`; }
export function factory(fail: boolean): () => string {
  return () => { if (fail) throw new Error("authored"); return "ok"; };
}
export function stored(fail: boolean): () => string {
  const callback = () => { if (fail) throw new Error("stored"); return "kept"; };
  return callback;
}
export function field(fail: boolean): { run: () => string } {
  return { run: () => { if (fail) throw new Error("field"); return "field"; } };
}
export function main(): void { factory(false)(); stored(false)(); field(false).run(); stringify(1); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /RaisingCallable\[Tuple\[\], String, Variant\[Error, TsError\]\]/u);
  assert.match(emitted, /raise Variant\[Error, TsError\]/u);
});
