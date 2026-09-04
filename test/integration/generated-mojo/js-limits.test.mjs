import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function compileBody(body) {
  return compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": `export function main(): void {\n${body}\n}`,
    },
  });
}

function assertTargetRejection(result, code) {
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [code]);
}

test("RegExp-dependent JavaScript operations select the exact ECMAScript runtime", () => {
  const result = compileBody(`
  const dynamic = new RegExp('a+', 'gi');
  dynamic.test('AAA');
  /a+/.test('aaa');
  'aaa'.search(/a+/);
  'aaa'.match(/a+/);
  'aaa'.matchAll(/a+/g);
  'e\\u0301'.normalize('NFC');`);
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"))?.text;
  assert.ok(source);
  for (const operation of [
    "regexp_construct",
    "test_value",
    "string_search_pattern",
    "string_match_pattern",
    "string_match_all_pattern",
    "string_normalize",
  ]) assert.match(source, new RegExp(`\\b${operation}\\b`, "u"));
});

test("unsupported JavaScript semantic families have one deterministic boundary", () => {
  assertTargetRejection(
    compileBody("  Object.assign({ value: 1 }, { other: 2 });"),
    "MOJO_OBJECT_ASSIGN_FIELD_RELATION_UNPROVEN",
  );
  assertTargetRejection(
    compileBody("  new Boolean(true);"),
    "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED",
  );
  assertTargetRejection(
    compileBody("  console.log({ value: 1 });"),
    "MOJO_CALL_ARGUMENT_CONVERSION_UNPROVEN",
  );
});

test("unavailable locale and reflection declarations fail during source checking", () => {
  assert.throws(
    () => compileBody("  'a'.localeCompare('b');"),
    /TS2339/u,
  );
  assert.throws(
    () => compileBody("  eval('1 + 1');"),
    /TS2304/u,
  );
});

test("neutral UTF-16 char never silently becomes a JavaScript number", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        'import type { char } from "@tsonic/core/types.js";',
        "export function stringify(value: char): string | undefined {",
        "  return JSON.stringify(value);",
        "}",
      ].join("\n"),
    },
  });
  assertTargetRejection(result, "MOJO_JSON_STRINGIFY_VALUE_UNSUPPORTED");
});
