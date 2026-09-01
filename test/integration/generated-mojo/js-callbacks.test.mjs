import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generatedSource(result) {
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  return source.text;
}

test("JavaScript array callbacks retain exact authored arities", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const values = [1, 2, 3];",
        "  values.map(() => 1);",
        "  values.map(value => value + 1);",
        "  values.map((value, index) => value + index);",
        "  values.map((value, index, array) => value + index + array.length);",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /tsonic_js\.array_map_zero\[Float64\]/u);
  assert.match(source, /tsonic_js\.array_map_value\[Float64\]/u);
  assert.match(source, /tsonic_js\.array_map_with_index\[Float64\]/u);
  assert.match(source, /tsonic_js\.array_map_with_array\[Float64\]/u);
  assert.equal((source.match(/tsonic_runtime\.RaisingCallable/gu) ?? []).length, 4);
});

test("JavaScript callback families select one sealed runtime operation", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "function visitMap(keyed: Map<string, number>): void {",
        "  keyed.forEach((value, key, map) => value + map.size);",
        "}",
        "function visitSet(unique: Set<number>): void {",
        "  unique.forEach((value, key, set) => value + key + set.size);",
        "}",
        "export function main(): void {",
        "  const values = [3, 1, 2];",
        "  values.filter((value, index) => value > index);",
        "  values.some(value => value === 2);",
        "  values.every(value => value > 0);",
        "  values.findLastIndex(value => value === 1);",
        "  values.reduce((sum, value, index, array) => sum + value + index + array.length, 0);",
        "  values.reduce((sum, value) => sum + value);",
        "  values.sort((left, right) => left - right);",
        "  values.forEach((value, index, array) => value + index + array.length);",
        "}",
      ].join("\n"),
    },
  }));
  for (const operation of [
    "array_filter_with_index",
    "array_some_value",
    "array_every_value",
    "array_find_last_index_value",
    "array_reduce_initial_with_array",
    "array_reduce_from_first_value",
    "array_sort_compare",
    "array_for_each_with_array",
    "map_for_each_with_map",
    "set_for_each_with_set",
  ]) {
    assert.match(source, new RegExp(`tsonic_js\\.${operation}`, "u"));
  }
});

test("JavaScript predicate callbacks fail closed without exact truthiness lowering", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const values = [0, 1, 2];",
        "  values.filter(value => value);",
        "}",
      ].join("\n"),
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) =>
    code === "MOJO_SOURCE_PROFILE_CALLBACK_TRUTHINESS_NOT_CLOSED"));
});
