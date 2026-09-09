import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generated(source) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).filter(({ path }) => path.startsWith("src/") && path.endsWith(".mojo"))
    .map(({ text }) => text).join("\n");
}

test("array coercion stays at the source runtime boundary with exact error effects", () => {
  const source = generated(`
    export function joined(): string { return [0, 1].join("|"); }
    export function sorted(): string { return [10, 1, 2].sort().join("|"); }
    export function copied(): number[] { return Array.from([1, 2]); }
    export function main(): void { joined(); sorted(); copied(); }
  `);
  assert.match(source, /array_join_native/u);
  assert.match(source, /def joined\(\) raises Error -> String/u);
  assert.match(source, /def sorted\(\) raises Error -> String/u);
  assert.match(source, /array_from/u);
  assert.doesNotMatch(source, /String\(Float64/u);
});

test("selected array iteration retains a live receiver and advances before the body", () => {
  const source = generated(`
    export function total(): number {
      const values = [1, 2];
      let total = 0;
      for (const value of values) {
        if (value === 1) { values.push(3); continue; }
        total += value;
      }
      return total;
    }
    export function main(): void { total(); }
  `);
  assert.match(source, /while \w+ < len\(\w+\):/u);
  assert.match(source, /\.read_value\(\w+\)/u);
  assert.match(source, /\+= 1\n\s+if value/u);
  assert.doesNotMatch(source, /\.iter_values\(\)/u);
});
