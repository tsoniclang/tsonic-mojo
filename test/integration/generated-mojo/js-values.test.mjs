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
  ]) assert.match(source, new RegExp(`\\b${operation}\\b`, "u"));
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
  assert.match(source, /\bjs_value_to_string\b/u);
  assert.match(source, /String\(error\)/u);
});

test("closed structural objects support identity-preserving assign and JSON replacers", () => {
  const source = generatedSource(compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const target = { count: 1, label: 'before' };",
        "  const assigned = Object.assign(target, { label: 'after' });",
        "  JSON.stringify({ keep: assigned.label, drop: 2 },",
        "    (key, value) => key === 'drop' ? undefined : value, 2);",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /StructuralObject/u);
  assert.match(source, /json_stringify_with_replacer_and_space_number/u);
  assert.match(source, /js_value_from_object_entries/u);
});

test("open Object.assign and property-list JSON replacers reject at the exact call boundary", () => {
  for (const [body, code] of [
    ["Object.assign({ value: 1 }, { other: 2 });", "MOJO_OBJECT_ASSIGN_FIELD_RELATION_UNPROVEN"],
    ["JSON.stringify({ value: 1 }, ['value']);", "MOJO_JSON_STRINGIFY_REPLACER_UNSUPPORTED"],
  ]) {
    const result = compileMojo({
      surfaces: ["js"],
      files: { "index.ts": `export function main(): void { ${body} }` },
    });
    assert.deepEqual(result.artifacts, []);
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [code]);
  }
});
