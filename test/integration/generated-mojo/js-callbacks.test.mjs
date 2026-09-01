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
        "  epoch.getTime(); epoch.valueOf(); epoch.getUTCFullYear(); epoch.getUTCMonth();",
        "  epoch.getUTCDate(); epoch.getUTCDay(); epoch.getUTCHours(); epoch.getUTCMinutes();",
        "  epoch.getUTCSeconds(); epoch.getUTCMilliseconds(); epoch.toISOString(); epoch.toJSON(); epoch.toUTCString(); epoch.toString();",
        "  epoch.setTime(0); epoch.setUTCMilliseconds(1); epoch.setUTCSeconds(2, 3);",
        "  epoch.setUTCMinutes(4, 5, 6); epoch.setUTCHours(7, 8, 9, 10);",
        "  epoch.setUTCDate(2); epoch.setUTCMonth(1, 3); epoch.setUTCFullYear(2000, 2, 4);",
        "  Date.parse(\"1970-01-01T00:00:00.000Z\"); Date.UTC(1970, 0); Date.now();",
        "  Math.abs(-1); Math.acos(1); Math.acosh(1); Math.asin(0); Math.asinh(0); Math.atan(0); Math.atan2(0, 1); Math.atanh(0);",
        "  Math.cbrt(8); Math.ceil(1.5); Math.clz32(1); Math.cos(0); Math.cosh(0); Math.exp(0); Math.expm1(0); Math.floor(1.5);",
        "  Math.fround(1.5); Math.hypot(3, 4); Math.imul(2, 3); Math.log(1); Math.log10(1); Math.log1p(0); Math.log2(1);",
        "  Math.max(1, 2); Math.min(1, 2); Math.pow(2, 3); Math.random(); Math.round(1.5); Math.sign(-1); Math.sin(0);",
        "  Math.sinh(0); Math.sqrt(4); Math.tan(0); Math.tanh(0); Math.trunc(1.5);",
        "  Math.E; Math.LN2; Math.LN10; Math.LOG2E; Math.LOG10E; Math.PI; Math.SQRT1_2; Math.SQRT2;",
        "  Number.parseInt(\"ff\", 16); Number.parseFloat(\"1.5\"); Number.isFinite(1); Number.isNaN(0);",
        "  Number.isInteger(1); Number.isSafeInteger(1); Number.EPSILON; Number.MAX_SAFE_INTEGER; Number.MIN_SAFE_INTEGER;",
        "  (123.456).toFixed(2); (77).toExponential(); (77).toExponential(2);",
        "  (12345).toPrecision(3); (12.5).toString(); (12.5).valueOf();",
        "}",
      ].join("\n"),
    },
  }));
  for (const operation of [
    "map_new", "set_new", "date_new", "date_parse", "date_utc", "date_now",
    "math_abs", "math_acos", "math_acosh", "math_asin", "math_asinh", "math_atan",
    "math_atan2", "math_atanh", "math_cbrt", "math_ceil", "math_clz32", "math_cos",
    "math_cosh", "math_exp", "math_expm1", "math_floor", "math_fround", "math_hypot",
    "math_imul", "math_log", "math_log10", "math_log1p", "math_log2", "math_max",
    "math_min", "math_pow", "math_random", "math_round", "math_sign", "math_sin",
    "math_sinh", "math_sqrt", "math_tan", "math_tanh", "math_trunc",
    "number_parse_int", "number_parse_float", "number_is_finite", "number_is_nan",
    "number_is_integer", "number_is_safe_integer",
    "number_to_fixed", "number_to_exponential_default", "number_to_exponential_digits",
    "number_to_precision_digits", "number_to_string", "number_value_of",
  ]) assert.match(source, new RegExp(`tsonic_js\\.${operation}`, "u"));
  for (const method of [
    "set", "get", "has", "keys", "values", "entries", "delete", "clear", "add",
    "union", "intersection", "difference", "symmetric_difference", "is_subset_of",
    "is_superset_of", "is_disjoint_from", "get_time", "get_utc_full_year", "to_iso_string",
    "get_utc_month", "get_utc_date", "get_utc_day", "get_utc_hours", "get_utc_minutes",
    "get_utc_seconds", "get_utc_milliseconds", "set_time", "set_utc_milliseconds",
    "set_utc_seconds", "set_utc_minutes", "set_utc_hours", "set_utc_date", "set_utc_month",
    "set_utc_full_year", "to_json", "to_utc_string", "to_string", "value_of",
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
