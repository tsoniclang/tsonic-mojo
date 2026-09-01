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

test("JavaScript predicate callbacks retain exact truthiness adapters", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const values = [0, 1, 2];",
        "  values.filter(value => value);",
        "  values.some(value => value === 0 ? \"\" : \"present\");",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /tsonic_js\.adapt_truthy_number_callback/u);
  assert.match(source, /tsonic_js\.adapt_truthy_string_callback/u);
});

test("JavaScript core collection date and math operations use sealed runtime rows", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const keyed = new Map<string, number>();",
        "  keyed.set(\"one\", 1);",
        "  keyed.get(\"one\");",
        "  keyed.has(\"one\");",
        "  keyed.keys(); keyed.values(); keyed.entries(); keyed.delete(\"one\"); keyed.clear();",
        "  const unique = new Set<number>();",
        "  unique.add(1); unique.has(1); unique.values(); unique.entries(); unique.delete(1); unique.clear();",
        "  unique.union(new Set<number>()); unique.intersection(new Set<number>());",
        "  unique.difference(new Set<number>()); unique.symmetricDifference(new Set<number>());",
        "  unique.isSubsetOf(new Set<number>()); unique.isSupersetOf(new Set<number>()); unique.isDisjointFrom(new Set<number>());",
        "  const epoch = new Date(0);",
        "  epoch.getTime(); epoch.getUTCFullYear(); epoch.toISOString(); epoch.toUTCString();",
        "  Date.parse(\"1970-01-01T00:00:00.000Z\"); Date.UTC(1970, 0); Date.now();",
        "  Math.floor(1.5); Math.ceil(1.5); Math.abs(-1); Math.max(1, 2); Math.sqrt(4); Math.random();",
        "  Number.parseInt(\"ff\", 16); Number.parseFloat(\"1.5\"); Number.isFinite(1); Number.isNaN(0);",
        "}",
      ].join("\n"),
    },
  }));
  for (const operation of [
    "map_new", "set_new", "date_new", "date_parse", "date_utc", "date_now",
    "math_floor", "math_ceil", "math_abs", "math_max", "math_sqrt", "math_random",
    "number_parse_int", "number_parse_float", "number_is_finite", "number_is_nan",
  ]) assert.match(source, new RegExp(`tsonic_js\\.${operation}`, "u"));
  for (const method of [
    "set", "get", "has", "keys", "values", "entries", "delete", "clear", "add",
    "union", "intersection", "difference", "symmetric_difference", "is_subset_of",
    "is_superset_of", "is_disjoint_from", "get_time", "get_utc_full_year", "to_iso_string",
    "to_utc_string",
  ]) assert.match(source, new RegExp(`\\.${method}\\(`, "u"));
});

test("JavaScript string and array operations retain exact source-profile selection", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const values = [1, 2, 3];",
        "  values.push(4); values.pop(); values.shift(); values.unshift(0);",
        "  values.splice(1, 1, 5); values.reverse(); values.sort(); values.fill(7, 0, 1);",
        "  values.copyWithin(1, 0, 1); values.includes(7); values.indexOf(7);",
        "  values.lastIndexOf(7); values.join(\",\"); values.slice(0, 2); values.at(-1);",
        "  const text = \"  Alpha beta Alpha  \";",
        "  text.toUpperCase(); text.toLowerCase(); text.includes(\"beta\");",
        "  text.startsWith(\"  Alpha\"); text.endsWith(\"Alpha  \");",
        "  text.indexOf(\"Alpha\"); text.lastIndexOf(\"Alpha\"); text.slice(2, 7);",
        "  text.at(-1); text.charAt(2); text.charCodeAt(2); text.codePointAt(2);",
        "  text.padStart(24, \"0\"); text.padEnd(24, \"0\"); text.repeat(2);",
        "  text.trim(); text.trimStart(); text.trimEnd(); text.trimLeft(); text.trimRight();",
        "  text.substring(2, 7); text.substr(2, 5); text.split(\" \", 2);",
        "  text.replace(\"Alpha\", \"Omega\"); text.replaceAll(\"Alpha\", \"Omega\");",
        "  text.concat(\"!\"); text.valueOf(); String.fromCharCode(65); String.fromCodePoint(0x1f600);",
        "}",
      ].join("\n"),
    },
  }));
  for (const method of [
    "push", "pop", "shift", "unshift", "splice", "reverse", "sort", "fill",
    "copy_within", "includes", "index_of", "last_index_of", "join", "slice", "at",
    "to_upper_case", "to_lower_case", "starts_with", "ends_with", "char_at",
    "char_code_at", "code_point_at", "pad_start", "pad_end", "repeat", "trim",
    "trim_start", "trim_end", "substring", "substr", "replace", "replace_all",
    "concat", "value_of",
  ]) assert.match(source, new RegExp(`\\.${method}\\(`, "u"));
  assert.match(source, /tsonic_js\.string_split/u);
  assert.match(source, /tsonic_js\.string_from_char_code/u);
  assert.match(source, /tsonic_js\.string_from_code_point/u);
});
