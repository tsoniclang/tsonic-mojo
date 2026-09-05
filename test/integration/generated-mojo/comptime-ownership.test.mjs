import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generatedEntry(result) {
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  return source.text;
}

test("compile-time values, conditions, and materialization retain exact target carriers", () => {
  const source = generatedEntry(compileMojo({
    files: {
      "index.ts": [
        'import { comptime, comptimeIf } from "@tsonic/core/lang.js";',
        'import { materialize } from "@tsonic/mojo/lang.js";',
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "export function main(): void {",
        "  const width = comptime<4>();",
        "  const value: i32 = comptime(3 as i32);",
        "  if (comptimeIf(width > 1)) {",
        "    const runtime: i32 = materialize(value);",
        "    void runtime;",
        "  }",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /comptime width: Float64 = 4/u);
  assert.match(source, /comptime value: Int32 = Int32\(3\)/u);
  assert.match(source, /comptime if width > Float64\(1\):/u);
  assert.match(source, /var runtime: Int32 = materialize\[value\]\(\)/u);
  assert.doesNotMatch(source, /comptime value: Int32 = Float64/u);
});

test("Mojo copy intent is selected by exact provider identity", () => {
  const source = generatedEntry(compileMojo({
    files: {
      "index.ts": [
        'import { copy as mojoCopy } from "@tsonic/mojo/lang.js";',
        "function copy<T>(value: T): T { return value; }",
        "export function main(): void {",
        '  const source = "value";',
        "  const selected = mojoCopy(source);",
        "  const local = copy(source);",
        "  void selected;",
        "  void local;",
        "}",
      ].join("\n"),
    },
  }));
  assert.match(source, /var selected: String = source\.copy\(\)/u);
  assert.match(source, /var local: String = copy\[String\]\(source\)/u);
});
