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
  assert.match(source, /array_map_zero\[Float64\]\(values, _callable\)/u);
  assert.match(source, /array_map_value\[Float64\]\(values, _callable_2\)/u);
  assert.match(source, /array_map_with_index\[Float64\]\(values, _callable_3\)/u);
  assert.match(source, /array_map_with_array\[Float64\]\(values, _callable_4\)/u);
  assert.match(source, /def _callable_4\(\n    value: Float64,\n    index: Float64,\n    array: JsArray\[Float64\],/u);
  assert.doesNotMatch(source, /RaisingCallable|GlobalCell/u);
});

test("JavaScript callback operations retain the callback's exact error domain", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "class CallbackFailure {",
        "  code: number;",
        "  constructor(code: number) { this.code = code; }",
        "}",
        "export function main(): void {",
        "  [1, -1].map(value => {",
        "    if (value < 0) throw new CallbackFailure(value);",
        "    return value + 1;",
        "  });",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /array_map_value\[/u);
  assert.match(source, /def _callable\(value: Float64\) raises CallbackFailure -> Float64/u);
  assert.match(source, /def tsonic_main\(\) raises CallbackFailure/u);
  assert.doesNotMatch(source, /RaisingCallable|array_map_value[^\n]*Variant\[/u);
});

test("JavaScript callbacks calling pure project functions retain an admitted helper domain", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "function compare(left: number, right: number): number { return left - right; }",
        "export function main(): void {",
        "  [3, 1, 2].sort((left, right) => compare(left, right));",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /from tsonic_js import array_sort_compare, JsArray/u);
  assert.match(source, /array_sort_compare\(/u);
  assert.match(source, /def tsonic_main\(\) raises Error/u);
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
    assert.match(source, new RegExp(`\\b${operation}\\b`, "u"));
  }
});

test("JavaScript predicate callbacks use native immediate adapters", () => {
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
  assert.match(source, /array_filter_value\(values, _callable\)/u);
  assert.match(source, /array_some_value\(values, _callable_2\)/u);
  assert.doesNotMatch(source, /lambda/u);
  assert.match(source, /return js_truthy_number\(value\)/u);
  assert.match(source, /return len\(.+\) != 0/u);
  assert.doesNotMatch(source, /js_truthy_number\(_immediate_callback\(/u);
  assert.doesNotMatch(source, /len\(_immediate_callback_2\(/u);
  assert.doesNotMatch(source, /adapt_truthy_|widen_callable|RaisingCallable/u);
});

test("identity-bearing callbacks bridge once into the native immediate ABI", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const increment = (value: number): number => value + 1;",
        "  const alias = increment;",
        "  const strictSame = alias === increment;",
        "  const looseSame = alias == increment;",
        "  const strictDifferent = alias !== increment;",
        "  const looseDifferent = alias != increment;",
        "  if (strictSame && looseSame && !strictDifferent && !looseDifferent) [1].map(alias);",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /Callable/u);
  assert.equal(source.match(/\.identity\(\) is(?: not)? .*\.identity\(\)/gu)?.length, 4);
  assert.doesNotMatch(source, /RaisingCallable/u);
  assert.match(source, /lambda/u);
  assert.match(source, /_immediate_callback\.call\(\(/u);
  assert.doesNotMatch(source, /adapt_truthy_|widen_callable\(_immediate_callback/u);
});

test("JavaScript core collection date and math operations use sealed runtime rows", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "import type { int32 } from '@tsonic/core/types.js';",
        "export function main(): void {",
        "  const keyed = new Map<string, number>();",
        "  keyed.set(\"one\", 1);",
        "  keyed.get(\"one\");",
        "  keyed.has(\"one\");",
        "  keyed.keys(); keyed.values(); keyed.entries(); keyed.delete(\"one\"); keyed.clear();",
        "  for (const entry of keyed) { entry[0]; entry[1]; }",
        "  const unique = new Set<number>();",
        "  unique.add(1); unique.has(1); unique.values(); unique.entries(); unique.delete(1); unique.clear();",
        "  for (const value of unique) { value; }",
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
        "  const radixValue: int32 = 255; radixValue.toString(16);",
        "  (true).toString(); (false).valueOf();",
        "  console.log('value', 1, true); console.info('info'); console.warn('warn');",
        "  console.error('error'); console.debug('debug');",
        "}",
      ].join("\n"),
    },
  }));
  for (const operation of [
    "map_new", "set_new", "date_new", "date_parse_native", "date_utc", "date_now",
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
    "number_to_string_radix",
    "boolean_to_string", "boolean_value_of", "console_log", "console_info",
    "console_warn", "console_error", "console_debug",
  ]) assert.match(source, new RegExp(`\\b${operation}\\b`, "u"));
  for (const method of [
    "set", "get", "has", "keys", "values", "entries", "delete", "clear", "add",
    "union", "intersection", "difference", "symmetric_difference", "is_subset_of",
    "is_superset_of", "is_disjoint_from", "get_time", "get_utc_full_year",
    "get_utc_month", "get_utc_date", "get_utc_day", "get_utc_hours", "get_utc_minutes",
    "get_utc_seconds", "get_utc_milliseconds", "set_time", "set_utc_milliseconds",
    "set_utc_seconds", "set_utc_minutes", "set_utc_hours", "set_utc_date", "set_utc_month",
    "set_utc_full_year", "value_of",
  ]) assert.match(source, new RegExp(`\\.${method}\\(`, "u"));
  for (const operation of [
    "date_to_iso_string_native", "date_to_json_native", "date_to_utc_string_native",
    "date_to_string_native",
  ]) assert.match(source, new RegExp(`\\b${operation}\\b`, "u"));
});

test("JavaScript radix formatting requires an exact integral receiver", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  (12.5).toString(16);",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "MOJO_SOURCE_PROFILE_RECEIVER_CAPABILITY_UNPROVEN",
  ]);
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
    "copy_within", "includes", "index_of", "last_index_of", "slice", "at",
  ]) assert.match(source, new RegExp(`\\.${method}\\(`, "u"));
  for (const operation of [
    "array_join_native", "native_string_to_upper_case", "native_string_to_lower_case",
    "native_string_includes", "native_string_starts_with", "native_string_ends_with",
    "native_string_index_of", "native_string_last_index_of", "native_string_slice",
    "native_string_at", "native_string_char_at", "native_string_char_code_at",
    "native_string_code_point_at", "native_string_pad_start", "native_string_pad_end",
    "native_string_repeat", "native_string_trim", "native_string_trim_start",
    "native_string_trim_end", "native_string_trim_left", "native_string_trim_right",
    "native_string_substring", "native_string_substr", "native_string_concat",
    "native_string_value_of", "native_string_from_char_code", "native_string_from_code_point",
  ]) assert.match(source, new RegExp(`\\b${operation}\\b`, "u"));
  assert.match(source, /\bstring_split_pattern\b/u);
  assert.match(source, /\bstring_replace_pattern\b/u);
  assert.match(source, /\bstring_replace_all_pattern\b/u);
  assert.doesNotMatch(source, /\.join\(|\.trim\(|\.to_upper_case\(/u);
});
