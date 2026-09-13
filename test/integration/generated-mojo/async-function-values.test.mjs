import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo, projectArtifactTexts } from "../../helpers/mojo-session.mjs";

for (const [name, declaration, reference] of [
  ["function", "async function load(value: string): Promise<string> { return value; }", "load"],
  ["static method", "class Loader { static async load(value: string): Promise<string> { return value; } }", "Loader.load"],
  ["quoted static method", 'class Loader { static async "load-value"(value: string): Promise<string> { return value; } }', 'Loader["load-value"]'],
]) {
  test(`first-class async ${name} retains arguments through native suspension`, () => {
    const result = compileMojo({ files: { "index.ts": `
${declaration}
export function callback(): (value: string) => Promise<string> { return ${reference}; }
export function same(): boolean { return ${reference} === ${reference}; }
export function main(): void {}
` } });
    assert.deepEqual(result.diagnostics, []);
    const text = projectArtifactTexts(result).map(({ text }) => text).join("\n");
    assert.match(text, /make_async_callable/u);
    assert.match(text, /ClosedRaisingCoroutine\[String\]/u);
    assert.match(text, /take_async_invocation/u);
    assert.match(text, /async def execute/u);
    assert.match(text, /await create_task/u);
    assert.doesNotMatch(text, /unsafe_origin_cast|\.wait\(/u);
  });
}

test("async declaration defaults and rest packing remain part of execution", () => {
  const result = compileMojo({ files: { "index.ts": `
async function load(value: string = "default", ...tail: string[]): Promise<string> {
  return tail.length === 0 ? value : value + tail[0];
}
export function callback(): (value?: string, ...tail: string[]) => Promise<string> { return load; }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(text, /Tuple\[Optional\[String\], List\[String\]\]/u);
  assert.match(text, /async def execute/u);
});

test("first-class async declarations retain source-selected import identity", () => {
  const result = compileMojo({ files: {
    "loader.ts": "export async function load(value: number): Promise<number> { return value + 1; }",
    "index.ts": `
import { load as first } from "./loader.js";
import { load as second } from "./loader.js";
export function same(): boolean { return first === second; }
export function callback(): (value: number) => Promise<number> { return first; }
export function main(): void {}
`,
  } });
  assert.deepEqual(result.diagnostics, []);
});

test("first-class async declarations cannot substitute native scheduling for JS promises", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
async function load(value: string): Promise<string> { return value; }
export function callback(): (value: string) => Promise<string> { return load; }
export function main(): void {}
` } });
  assert.ok(result.diagnostics.length > 0);
  assert.deepEqual(result.artifacts, []);
});
