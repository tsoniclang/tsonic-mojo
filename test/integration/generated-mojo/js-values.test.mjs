import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generatedSource(result) {
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  return source.text;
}

test("closed JSON values retain exact parse stringify and Object operations", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const parsed = JSON.parse('{\"2\":\"two\",\"1\":true,\"plain\":1}');",
        "  JSON.stringify(parsed);",
        "  Object.is(parsed, parsed);",
        "  const record = parsed as { [key: string]: unknown };",
        "  Object.keys(record);",
        "  Object.values(record);",
        "  Object.entries(record);",
        "  Object.hasOwn(record, 'plain');",
        "  record.hasOwnProperty('plain');",
        "}",
      ].join("\n"),
    },
  }));
  for (const operation of [
    "json_parse",
    "json_stringify",
    "object_is",
    "object_keys",
    "object_values",
    "object_entries",
    "object_has_own",
  ]) assert.match(source, new RegExp(`tsonic_js\\.${operation}`, "u"));
});

test("dynamic and finalized catch values use exact closed template stringification", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "function show(value: unknown): string { return `value=${value}`; }",
        "export function main(): void {",
        "  show(JSON.parse('{\"ready\":true}'));",
        "  try { decodeURIComponent('%'); } catch (error) { `${error}`; }",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /tsonic_js\.js_value_to_string/u);
  assert.match(source, /String\(error\)/u);
});

test("JSON replacer arguments reject at the sealed source-profile boundary", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  JSON.stringify({ ready: true }, null);",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED",
  ]);
});
