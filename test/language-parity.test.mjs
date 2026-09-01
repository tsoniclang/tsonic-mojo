import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "./helpers/mojo-session.mjs";

test("module initialization is source ordered, dependency ordered, and idempotent", () => {
  const result = compileMojo({
    files: {
      "setup.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "export let initialized: i32 = 1;",
        "initialized += 1;",
      ].join("\n"),
      "index.ts": [
        'import "./setup.js";',
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = artifactTexts(result);
  const setup = sources.find(({ text }) => text.includes("initialized: Optional[Int32]"));
  const entry = sources.find(({ text }) => text.includes("def main()"));
  assert.ok(setup);
  assert.ok(entry);
  assert.match(setup.text, /\.initialized = Optional\[Int32\]\(Int32\(1\)\)[\s\S]*\.initialized\.value\(\) \+= Int32\(1\)/u);
  assert.match(entry.text, /initializeTsonicModule/u);
});

test("class static fields and blocks share one exact module-state path", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class Counter {",
        "  static total: i32 = 1;",
        "  static { Counter.total += 2; }",
        "}",
        "export function main(): void { Counter.total += 3; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct Counter"));
  assert.ok(source);
  const slots = source.text.match(/Counter_total/g) ?? [];
  assert.ok(slots.length >= 4);
  assert.match(source.text, /Counter_total\.value\(\) \+= Int32\(2\)/u);
  assert.match(source.text, /Counter_total\.value\(\) \+= Int32\(3\)/u);
});

test("numeric enums retain checker-evaluated discriminants and exact member identity", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "enum Mode { Off, On = 4 }",
        "function consume(selected: Mode): void {",
        "  if (selected === Mode.Off) return;",
        "}",
        "export function main(): void {",
        "  consume(Mode.On);",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct Mode"));
  assert.ok(source);
  assert.match(source.text, /comptime Off: Mode = Mode\(0\)/u);
  assert.match(source.text, /comptime On: Mode = Mode\(4\)/u);
  assert.match(source.text, /def consume\(var selected: Mode\)/u);
  assert.match(source.text, /if \(selected == Mode\.Off\):/u);
});

test("runtime-reachable module cycles reject before output planning", () => {
  const result = compileMojo({
    files: {
      "a.ts": 'import "./b.js"; export function a(): void {}',
      "b.ts": 'import "./a.js"; import "./state.js"; export function b(): void {}',
      "state.ts": 'import type { i32 } from "@tsonic/mojo/types.js"; export let value: i32 = 1;',
      "index.ts": 'import "./a.js"; export function main(): void {}',
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "MOJO_RUNTIME_MODULE_CYCLE_UNSUPPORTED",
  ]);
});
