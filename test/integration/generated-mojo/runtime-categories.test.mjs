import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo, projectArtifactTexts } from "../../helpers/mojo-session.mjs";

test("typeof selects exact union, optional and closed dynamic categories without boxing", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
function category(value: string | number | null | undefined): string { return typeof value; }
function erased(value: unknown): string { return typeof value; }
export function main(): void {
  console.log(category("text"), category(2), category(null), category(undefined));
  console.log(erased("text"), erased(2), erased(null), erased(undefined));
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /\.isa\[/u);
  assert.match(output, /\.type_of\(\)/u);
  assert.match(output, /"undefined"/u);
  assert.match(output, /"object"/u);
});

test("typeof preserves side-effectful operand evaluation exactly once", () => {
  const result = compileMojo({ files: { "index.ts": `
let visits = 0;
function next(): string | number { visits++; return visits === 1 ? "one" : visits; }
export function main(): void { const category = typeof next(); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.equal([...output.matchAll(/(?<!def )\bnext\(\)/gu)].length, 1);
});

test("boxed nullish comparisons retain strictness and both operand orders", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
function compare(value: unknown): boolean {
  return value === undefined || null === value || value == null || undefined != value;
}
export function main(): void { console.log(compare(null), compare(undefined), compare(1)); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /\.is_null\(\)/u);
  assert.match(output, /\.is_undefined\(\)/u);
});
