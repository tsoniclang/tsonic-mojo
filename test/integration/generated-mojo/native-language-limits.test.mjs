import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo } from "../../helpers/mojo-session.mjs";

const i32 = 'import type { i32 } from "@tsonic/mojo/types.js";';

const cases = Object.freeze([
  Object.freeze({
    lane: "generators.bidirectional",
    expected: Object.freeze(["MOJO_GENERATOR_NATIVE_LIMIT"]),
    source: `${i32} function* values(): Generator<i32, string, i32> { const next = yield 1; return "done"; } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "generators.async",
    expected: Object.freeze(["MOJO_GENERATOR_NATIVE_LIMIT"]),
    source: `${i32} async function load(): Promise<i32> { return 1; } async function* values() { yield await load(); } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "generators.resource-suspension",
    expected: Object.freeze(["MOJO_GENERATOR_NATIVE_LIMIT"]),
    source: `${i32} class Resource { value: i32 = 1; [Symbol.dispose](): void {} } function* values() { using resource = new Resource(); yield resource.value; } export function main(): void {}`,
  }),
]);

for (const fixture of cases) {
  test(`${fixture.lane} rejects at its exact Mojo boundary`, () => {
    const result = compileMojo({ files: { "index.ts": fixture.source } });
    assert.equal(result.artifacts.length, 0);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), fixture.expected);
  });
}
