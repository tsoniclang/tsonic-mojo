import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("collection iterator results preserve their live runtime carrier", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": `
export function main(): void {
  const values = new Set<number>();
  values.add(1);
  const iterator = values.values();
  const first = iterator.next();
  if (!first.done) console.log(first.value);
  values.add(2);
  const collected = Array.from(iterator);
  for (const value of collected) console.log(value);
  const entries = new Map<number, string>();
  entries.set(1, "one");
  for (const [key, value] of entries) {
    console.log(key, value);
    entries.delete(key);
  }
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(source, /JsIterator/u);
  assert.match(source, /\.values\(\)/u);
  assert.match(source, /\.iter_entries\(\)/u);
  assert.match(source, /array_from\(/u);
  assert.match(source, /\.next\(\)/u);
  assert.match(source, /get_done\(\)/u);
  assert.match(source, /get_value\(\)/u);
});

test("iterator result operations follow exact profile declarations, not member spelling", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": `
class Counter {
  next(): number { return 7; }
}
export function main(): void {
  const local = new Counter();
  console.log(local.next());
  const source = new Set<string>();
  source.add("one");
  const iterator: IterableIterator<string> = source.values();
  const result: IteratorResult<string> = iterator.next(9);
  if (result.done) console.log("end");
  else console.log(result.value);
}
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(source, /JsIterator/u);
  assert.match(source, /get_value\(\)/u);
});
