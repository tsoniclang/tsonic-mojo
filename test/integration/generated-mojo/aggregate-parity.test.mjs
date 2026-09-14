import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const fixtures = [
  ["leading and trailing holes", "const values = [, 1, ,]; return values.length === 3;"],
  ["all omitted slots", "const values = [,,,]; return values.length === 3;"],
  ["missing slots differ from explicit undefined", "const values = [1, , undefined, 3]; return !Object.hasOwn(values, '1') && Object.hasOwn(values, '2');"],
  ["holes around dynamic array spreads", "const input = [1, 2]; const values = [, ...input, , 3,]; return values.length === 5;"],
  ["array iteration materializes undefined", "const input = [1, , 3]; const values = [...input]; return Object.hasOwn(values, '1') && values[1] === undefined;"],
  ["set spread", "const values = [...new Set([1, 2, 1])]; return values.length === 2;"],
  ["map spread", "const map = new Map<string, number>(); map.set('a', 3); const values = [...map]; return values.length === 1;"],
  ["iterator spread", "const values = [...new Set([1, 2]).values()]; return values.length === 2;"],
];

for (const [name, body] of fixtures) {
  test(`closed aggregate parity: ${name}`, () => {
    const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, surfaces: ["js"], files: { "index.ts": `export function proof(): boolean { ${body} }` } });
    assert.deepEqual(result.diagnostics, []);
    const text = artifactTexts(result).filter(({ path }) => path.startsWith("src/")).map(({ text }) => text).join("\n");
    assert.match(text, /def proof\(/u);
    if (name.includes("holes") || name.includes("slots")) assert.match(text, /elements=/u);
  });
}

test("sparse literals never silently select a native dense array representation", () => {
  const result = compileMojo({ files: { "index.ts": "export function count(): number { return [1, , 3].length; }" } });
  assert.deepEqual(result.artifacts, []);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_ARRAY_LITERAL_HOLE_UNSUPPORTED"));
});
