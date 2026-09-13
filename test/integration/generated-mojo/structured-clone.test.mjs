import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo, projectArtifactTexts } from "../../helpers/mojo-session.mjs";

test("structuredClone consumes data without invoking toJSON and uses the exact result contract", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class Source { value = 1; toJSON(): string { throw new Error('must not run'); } }
export function main(): void {
  const copy = structuredClone<unknown>(new Source());
  console.log(copy, structuredClone(1), structuredClone('text'), structuredClone(true));
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /js_value_structured_clone\(/u);
  assert.match(output, /js_value_from_source_object\(/u);
  assert.match(output, /js_value_number\(/u);
  assert.match(output, /js_value_native_string\(/u);
  assert.match(output, /js_value_bool\(/u);
});

test("structuredClone cannot fabricate a retained class prototype", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class Source { value = 1; read(): number { return this.value; } }
export function main(): void { console.log(structuredClone(new Source()).read()); }
` } });
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_SOURCE_PROFILE_RUNTIME_RESULT_CONVERSION_UNPROVEN"));
  assert.equal(result.artifacts.length, 0);
});

test("structuredClone is surface-owned and cannot be selected from a same-spelled function", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": 'export function main(): void { structuredClone(1); }' } }), /TS2304/u);
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
function structuredClone(value: number): number { return value + 1; }
export function main(): void { console.log(structuredClone(1)); }
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(projectArtifactTexts(result).map(({ text }) => text).join("\n"), /js_value_structured_clone\(/u);
});
