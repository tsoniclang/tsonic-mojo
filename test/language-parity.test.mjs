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

test("default export expressions retain one source-ordered binding and imported identity", () => {
  const result = compileMojo({
    files: {
      "settings.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "let calls: i32 = 0;",
        "function load(): i32 { calls += 1; return 41; }",
        "export function loadCount(): i32 { return calls; }",
        "export default load();",
      ].join("\n"),
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        'import selected, { loadCount } from "./settings.js";',
        "export function main(): void {",
        "  const value: i32 = selected;",
        "  if (value !== 41 || selected !== 41 || loadCount() !== 1) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const settings = artifactTexts(result).find(({ path }) => path.endsWith("settings.mojo"));
  const entry = artifactTexts(result).find(({ path }) => path.endsWith("index.mojo"));
  assert.ok(settings);
  assert.ok(entry);
  assert.equal((settings.text.match(/load\(\)/gu) ?? []).length, 2);
  assert.match(settings.text, /defaultExport/u);
  assert.match(entry.text, /settings\.tsonicModuleState\.get\(\)\[\]\.defaultExport\.value\(\)/u);
});

test("generic functions retain exact selected type arguments", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function identity<T>(value: T): T { return value; }",
        "export function main(): void {",
        "  const value: i32 = identity<i32>(7);",
        "  if (value !== 7) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def identity"));
  assert.ok(source);
  assert.match(source.text, /def identity\[T: AnyType\]\(var value: T\) -> T/u);
  assert.match(source.text, /identity\[Int32\]\(Int32\(7\)\)/u);
});

test("project classes retain reference identity and declaration-owned private storage", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class Counter {",
        "  #value: i32 = 1;",
        "  increment(): i32 { this.#value += 1; return this.#value; }",
        "}",
        "export function main(): void {",
        "  const counter = new Counter();",
        "  if (counter.increment() !== 2) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct CounterState"));
  assert.ok(source);
  assert.match(source.text, /struct CounterState/u);
  assert.match(source.text, /var _value: Int32/u);
  assert.match(source.text, /struct Counter[\s\S]*ArcPointer\[CounterState\]/u);
  assert.doesNotMatch(source.text, /#value/u);
});

test("class static fields without initializers reject instead of inventing target defaults", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class Counter { static total: i32; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "MOJO_CLASS_STATIC_FIELD_INITIALIZER_REQUIRED",
  ]);
});

test("structured loops switch and cleanup retain source control flow", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function select(value: i32): i32 {",
        "  let total: i32 = 0;",
        "  for (let index: i32 = 0; index < value; index += 1) {",
        "    if (index === 1) continue;",
        "    total += index;",
        "  }",
        "  switch (value) { case 2: total += 10; break; default: total += 20; }",
        "  try { total += value; } catch { total = 0; } finally { total += 1; }",
        "  return total;",
        "}",
        "export function main(): void { if (select(2) !== 13) return; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def select"));
  assert.ok(source);
  assert.match(source.text, /while/u);
  assert.match(source.text, /continue/u);
  assert.match(source.text, /try:/u);
  assert.match(source.text, /finally:/u);
});

test("native async functions retain Promise output evidence and schedule exact awaits", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "async function value(): Promise<i32> { return 7; }",
        "export async function main(): Promise<void> {",
        "  const selected: i32 = await value();",
        "  if (selected !== 7) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("async def value"));
  const entry = artifactTexts(result).find(({ path }) => path.endsWith("main.mojo"));
  assert.ok(source);
  assert.ok(entry);
  assert.match(source.text, /async def value\(\) -> Int32/u);
  assert.match(source.text, /await create_task\(value\(\)\)/u);
  assert.match(entry.text, /create_task\(__tsonic_entry\(\)\)\.wait\(\)/u);
});
