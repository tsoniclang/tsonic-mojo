import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

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
  assert.match(setup.text, /\.initialized = Optional\[Int32\]\(1\)[\s\S]*\.initialized\.value\(\) \+= 1/u);
  assert.match(entry.text, /initializeTsonicModule/u);
});

test("top-level await propagates one asynchronous module bootstrap", () => {
  const result = compileMojo({
    files: {
      "value.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "async function load(): Promise<i32> { return 7; }",
        "export const value: i32 = await load();",
      ].join("\n"),
      "index.ts": [
        'import { value } from "./value.js";',
        "export function main(): void { if (value !== 7) return; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = artifactTexts(result);
  const value = sources.find(({ path }) => path.endsWith("value.mojo"));
  const entry = sources.find(({ path }) => path.endsWith("main.mojo"));
  assert.ok(value);
  assert.ok(entry);
  assert.match(value.text, /async def initializeTsonicModule/u);
  assert.match(value.text, /await create_task\(load\(\)\)/u);
  assert.match(entry.text, /create_task\(__tsonic_async_entry\(\)\)\.wait\(\)/u);
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

test("switch fallthrough retains selector order and an explicit break boundary", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function select(value: i32): i32 {",
        "  let total: i32 = 0;",
        "  switch (value) {",
        "    case 1: total += 1;",
        "    case 2: total += 2; break;",
        "    default: total += 4;",
        "  }",
        "  return total;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def select"));
  assert.ok(source);
  assert.match(source.text, /__tsonic_switch_value/u);
  assert.match(source.text, /__tsonic_switch_clause/u);
  assert.match(source.text, /while True:/u);
  assert.match(source.text, /total \+= 1[\s\S]*total \+= 2/u);
});

test("try catch and finally retain one error boundary and mandatory cleanup", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function select(value: i32): i32 {",
        "  let total: i32 = 0;",
        "  try { if (value === 0) throw \"bad\"; total = 1; }",
        "  catch (error) { total = 2; }",
        "  finally { total += 4; }",
        "  return total;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def select"));
  assert.ok(source);
  assert.match(source.text, /try:/u);
  assert.match(source.text, /except error:/u);
  assert.match(source.text, /finally:/u);
  assert.match(source.text, /raise/u);
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
  assert.match(entry.text, /create_task\(__tsonic_async_entry\(\)\)\.wait\(\)/u);
});

test("project interface objects retain selected generic fields and source-ordered spread overrides", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Pair<T> { left: T; right: T; }",
        "function sum(): i32 {",
        "  const first: Pair<i32> = { left: 1, right: 2 };",
        "  const next: Pair<i32> = { ...first, left: 3 };",
        "  return next.left + next.right;",
        "}",
        "export function main(): void { if (sum() !== 5) return; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct PairState"));
  assert.ok(source);
  assert.match(source.text, /struct PairState\[T: AnyType\]/u);
  assert.match(source.text, /struct Pair\[T: AnyType\][\s\S]*ArcPointer\[PairState\[T\]\]/u);
  assert.match(source.text, /Pair\[Int32\]\(/u);
  assert.match(source.text, /object_spread/u);
});

test("authored scalar array tuple and FixedArray carriers survive collapsed TypeScript number types", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { FixedArray, uint8 } from "@tsonic/core/types.js";',
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function sum(): i32 {",
        "  const values: i32[] = [1, 2];",
        '  const tuple: [i32, string] = [3, "three"];',
        "  const bytes: FixedArray<uint8, 2> = [4, 5];",
        "  return values[0] + tuple[0] + bytes[1];",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def sum"));
  assert.ok(source);
  assert.match(source.text, /var values: List\[Int32\] = \[1, 2\]/u);
  assert.match(source.text, /var tuple: Tuple\[Int32, String\] = \(3, "three"\)/u);
  assert.match(source.text, /var bytes: Array\[UInt8, 2\] = Array\[UInt8, 2\]\(4, 5\)/u);
  assert.match(source.text, /values\[Int\(0\)\].*tuple\[Int\(0\)\].*Int32\(bytes\[Int\(1\)\]\)/u);
});

test("all native Mojo and shared fixed-width primitive aliases retain authored carriers", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { bool, i8, u8, i16, u16, i32, u32, i64, u64, isize, usize, f16, f32, f64 } from "@tsonic/mojo/types.js";',
        'import type { char, int128, uint128 } from "@tsonic/core/types.js";',
        "function preserve(a: bool, b: char, c: i8, d: u8, e: i16, f: u16, g: i32, h: u32, i: i64, j: u64, k: isize, l: usize, m: f16, n: f32, o: f64, p: int128, q: uint128): [bool, char, i8, u8, i16, u16, i32, u32, i64, u64, isize, usize, f16, f32, f64, int128, uint128] {",
        "  return [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q];",
        "}",
        "function integerLiterals(): [i64, u64] { return [-1n, 2n]; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def preserve"));
  assert.ok(source);
  for (const type of [
    "Bool", "UInt16", "Int8", "UInt8", "Int16", "Int32", "UInt32", "Int64",
    "UInt64", "Int", "UInt", "Float16", "Float32", "Float64", "Int128", "UInt128",
  ]) assert.match(source.text, new RegExp(`\\b${type}\\b`, "u"));
  assert.match(source.text, /return \(-1, 2\)/u);
});

test("decimal rejects at target type closure because the pinned Mojo toolchain has no decimal carrier", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { decimal } from "@tsonic/core/types.js";',
        "function preserve(value: decimal): decimal { return value; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code, message }) =>
    code === "MOJO_TARGET_TYPE_UNSUPPORTED" && message.includes("decimal")));
});

test("nested optional property reads and nullish fallback retain explicit Optional projections", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Value { count: i32; }",
        "interface Box { value?: Value; }",
        "function count(box: Box | undefined): i32 {",
        "  return box?.value?.count ?? 0;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def count"));
  assert.ok(source);
  assert.match(source.text, /Optional\[/u);
  assert.match(source.text, /if __tsonic_optional_receiver_/u);
  assert.match(source.text, /\.value\(\)/u);
});

test("open dynamic element access rejects before planning without reflective recovery", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "function read(value: any, name: string): any { return value[name]; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_ELEMENT_TARGET_UNSUPPORTED"));
});

test("expression callables retain exact erased parameter result and direct-call contracts", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function apply(value: i32, transform: (value: i32) => i32): i32 {",
        "  return transform(value);",
        "}",
        "export function main(): void {",
        "  const double = (value: i32): i32 => value + value;",
        "  if (apply(4, double) !== 8) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def apply"));
  assert.ok(source);
  assert.match(source.text, /transform: tsonic_runtime\.Callable\[Tuple\[Int32\], Int32\]/u);
  assert.match(source.text, /transform\.call\(\(value,\)\)/u);
  assert.match(source.text, /struct __tsonic_callable_environment_\d+:/u);
  assert.match(source.text, /def invoke\([^)]*Tuple\[Int32\]\) -> Int32:/u);
  assert.match(source.text, /return \(value \+ value\)/u);
});

test("expression callables retain exact immutable captures", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function select(base: i32): i32 {",
        "  const offset: i32 = 3;",
        "  const add = (value: i32): i32 => value + offset;",
        "  return add(base);",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def select"));
  assert.ok(source);
  assert.match(source.text, /allocate_callable_environment\([^\n]*offset\.copy\(\)/u);
  assert.match(source.text, /struct __tsonic_callable_environment_\d+:[\s\S]*var offset: Int32/u);
  assert.match(source.text, /pointer\[\]\.offset\.copy\(\)/u);
});

test("block-bodied callable expressions lower through one generated environment", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "export function main(): void {",
        "  const value = (): i32 => { return 1; };",
        "  value();",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct __tsonic_callable_environment_"));
  assert.ok(source);
  assert.match(source.text, /Callable\[Tuple\[\], Int32\]/u);
  assert.match(source.text, /def invoke\([^)]*Tuple\[\]\) -> Int32:[\s\S]*return 1/u);
  assert.match(source.text, /value\.call\(\(\)\)/u);
});

test("mutable captures share one explicit Location across retained callable invocations", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function count(): i32 {",
        "  let total: i32 = 1;",
        "  const bump = (): i32 => { total += 1; return total; };",
        "  bump();",
        "  return bump();",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def count"));
  assert.ok(source);
  assert.match(source.text, /total_location: tsonic_runtime\.Location\[Int32\]/u);
  assert.match(source.text, /total_location\.copy\(\)/u);
  assert.match(source.text, /total_location\.write\(/u);
  assert.match(source.text, /total_location\.read\(\)/u);
});

test("discarded non-unit calls retain effects without native unused-result warnings", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function value(): i32 { return 1; }",
        "export function main(): void { value(); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  assert.match(source.text, /_ = value\(\)/u);
});

test("binding patterns retain exact single-evaluation aggregate projections", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Pair<T> { left: T; right: T; }",
        "function makePair(): Pair<i32> { return { left: 2, right: 3 }; }",
        "function sum(values: [i32, Pair<i32>, i32]): i32 {",
        "  const [first, { right: second }, third] = values;",
        "  const { left, right: renamed } = makePair();",
        "  const [, selected]: [i32, i32] = [7, 11];",
        "  return first + second + third + left + renamed + selected;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def sum"));
  assert.ok(source);
  assert.match(source.text, /var __tsonic_binding_source_\d+: Tuple\[Int32, Pair\[Int32\], Int32\] = values/u);
  assert.match(source.text, /var first: Int32 = __tsonic_binding_source_\d+\[0\]/u);
  assert.match(source.text, /var second: Int32 = __tsonic_binding_nested_\d+\._state\[\]\.right/u);
  assert.match(source.text, /var renamed: Int32 = __tsonic_binding_source_\d+\._state\[\]\.right/u);
  assert.equal((source.text.match(/= makePair\(\)/gu) ?? []).length, 1);
});

test("destructuring rest and defaults retain exact source order and closed carriers", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Pair { left: i32; right: i32; }",
        "function read(values: i32[], tuple: [i32, i32, i32], pair: Pair): i32 {",
        "  const [head = 7, ...tail]: i32[] = values;",
        "  const [first, ...tupleTail] = tuple;",
        "  const { left, ...remaining } = pair;",
        "  return head + tail[0] + first + tupleTail[0] + left + remaining.right;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def read"));
  assert.ok(source);
  assert.match(source.text, /if __tsonic_binding_optional_\d+:/u);
  assert.match(source.text, /List\[Int32\]\(__tsonic_binding_source_\d+\[1:\]\)/u);
  assert.match(source.text, /var tupleTail: Tuple\[Int32, Int32\] = \(__tsonic_binding_source_\d+\[1\], __tsonic_binding_source_\d+\[2\]\)/u);
  assert.match(source.text, /StructuralObject\[Tuple\[Int32\]\]/u);
  assert.match(source.text, /remaining\._state\[\]\[0\]/u);
});

test("synchronous list and dictionary iteration retain selected element carriers", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function sum(values: i32[]): i32 {",
        "  let total: i32 = 0;",
        "  for (const value of values) total += value;",
        "  return total;",
        "}",
        "function count(values: Record<string, i32>): i32 {",
        "  let total: i32 = 0;",
        "  for (const key in values) total += values[key];",
        "  return total;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def sum"));
  assert.ok(source);
  assert.match(source.text, /for value in values:/u);
  assert.match(source.text, /for key in values\.keys\(\):/u);
});

test("asynchronous iteration rejects at the pinned Mojo language boundary", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "async function consume(values: i32[]): Promise<void> {",
        "  for await (const value of values) { if (value === 0) return; }",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_ASYNC_ITERATION_NATIVE_LIMIT"));
});

test("typed locations retain exact mutable storage identity", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import { addressOf, loadPointer, storePointer } from "@tsonic/core/lang.js";',
        'import type { int32 } from "@tsonic/core/types.js";',
        "function increment(): int32 {",
        "  let value: int32 = 1;",
        "  const location = addressOf(value);",
        "  storePointer(location, loadPointer(location) + 1);",
        "  return value;",
        "}",
        "export function main(): void { if (increment() !== 2) return; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def increment"));
  assert.ok(source);
  assert.match(source.text, /Location\[Int32\]/u);
  assert.match(source.text, /\.read\(\)/u);
  assert.match(source.text, /\.write\(/u);
});

test("native pointers lower only inside an exact explicit unsafe region", () => {
  const source = [
    'import { loadNativePointer, offsetNativePointer, storeNativePointer, unsafeContext } from "@tsonic/core/lang.js";',
    'import type { NativePointer, int32, nativeInt } from "@tsonic/core/types.js";',
    "export function copy(source: NativePointer<int32>, destination: NativePointer<int32>, offset: nativeInt): NativePointer<int32> {",
    "  unsafeContext();",
    "  storeNativePointer(destination, loadNativePointer(source));",
    "  return offsetNativePointer(source, offset);",
    "}",
    "export function read(source: NativePointer<int32>): int32 {",
    "  return unsafeContext(loadNativePointer(source));",
    "}",
    "export function main(): void {}",
  ].join("\n");
  const result = compileMojo({ files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def copy"));
  assert.ok(generated);
  assert.match(generated.text, /Pointer\[Int32, MutUnsafeAnyOrigin\]/u);
  assert.match(generated.text, /destination\[\] = source\[\]/u);
  assert.match(generated.text, /source\.unsafe_offset\(offset\)/u);
  assert.doesNotMatch(generated.text, /loadNativePointer|storeNativePointer|offsetNativePointer|unsafeContext/u);

  const rejected = compileMojo({
    files: {
      "index.ts": [
        'import { loadNativePointer } from "@tsonic/core/lang.js";',
        'import type { NativePointer, int32 } from "@tsonic/core/types.js";',
        "export function read(pointer: NativePointer<int32>): int32 { return loadNativePointer(pointer); }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(rejected.artifacts.length, 0);
  assert.ok(rejected.diagnostics.some(({ code }) =>
    code === "MOJO_NATIVE_POINTER_UNSAFE_CONTEXT_REQUIRED"));

  const conflictingPointee = compileMojo({
    files: {
      "index.ts": [
        'import { loadNativePointer, unsafeContext } from "@tsonic/core/lang.js";',
        'import type { NativePointer, int32, uint8 } from "@tsonic/core/types.js";',
        "export function read(pointer: NativePointer<int32>): uint8 {",
        "  return unsafeContext(loadNativePointer<uint8>(pointer as unknown as NativePointer<uint8>));",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(conflictingPointee.artifacts.length, 0);
  assert.ok(conflictingPointee.diagnostics.some(({ code }) =>
    code === "MOJO_NATIVE_POINTER_POINTEE_CONFLICT"));
});

test("raw pointer identity is closed only from exact source-core facts", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import { bindRawPointer, equalRawPointer, hashRawPointer } from "@tsonic/core/lang.js";',
        'import type { float64 } from "@tsonic/core/types.js";',
        "class Box { value: float64 = 1; }",
        "export function main(): void {",
        "  const box = new Box();",
        "  const first = bindRawPointer(box);",
        "  const second = bindRawPointer(box);",
        "  const same = equalRawPointer(first, second);",
        "  const hash = hashRawPointer(first);",
        "  if (!same || hash < 0) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("struct Box"));
  assert.ok(generated);
  assert.match(generated.text, /raw_pointer_from_arc\(box\._state\)/u);
  assert.match(generated.text, /equal_raw_pointer\(/u);
  assert.match(generated.text, /hash_raw_pointer\(/u);
  assert.doesNotMatch(generated.text, /bindRawPointer|equalRawPointer|hashRawPointer/u);
});

test("discriminated project unions select one exact object constituent and common read", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        'interface Circle { kind: "circle"; radius: i32; }',
        'interface Square { kind: "square"; side: i32; }',
        "type Shape = Circle | Square;",
        "function area(shape: Shape): i32 {",
        '  if (shape.kind === "circle") return shape.radius;',
        "  return shape.side;",
        "}",
        'export function main(): void { area({ kind: "circle", radius: 2 }); }',
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def area"));
  assert.ok(generated);
  assert.match(generated.text, /Variant\[Circle, Square\]\(Circle\(/u);
  assert.match(generated.text, /\.isa\[Circle\]\(\)/u);
  assert.match(generated.text, /shape\[Circle\].*\.radius/u);
  assert.match(generated.text, /shape\[Square\].*\.side/u);

  const divergent = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface TextValue { value: string; }",
        "interface NumberValue { value: i32; }",
        "type Mixed = TextValue | NumberValue;",
        "function read(value: Mixed): string | i32 { return value.value; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.equal(divergent.artifacts.length, 0);
  assert.ok(divergent.diagnostics.some(({ code }) =>
    code === "MOJO_PROJECT_UNION_PROPERTY_RESULT_UNCLOSED"));
});

test("native length reads retain their exact numeric conversion in comparisons", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "export function main(): void {",
        "  const text = 'value';",
        "  const values = [1, 2, 3];",
        "  if (text.length >= 0 && values.length <= 3) return;",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  assert.equal((source.text.match(/\.__len__\(\)/gu) ?? []).length, 2);
  assert.match(source.text, /Float64\([^\n]*\.__len__\(\)\) >= 0/u);
  assert.match(source.text, /Float64\([^\n]*\.__len__\(\)\) <= 3/u);
});

test("project interface index signatures retain exact map-backed storage and source order", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Scores { [name: string]: i32; }",
        "function total(name: string): i32 {",
        "  const initial: Scores = { first: 1, [name]: 2 };",
        "  initial.second = 3;",
        '  initial["first"] += 4;',
        "  const copied: Scores = { ...initial, fourth: 5 };",
        '  return copied.first + copied[name] + copied["second"] + copied.fourth;',
        "}",
        'export function main(): void { if (total("third") !== 15) return; }',
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct ScoresState"));
  assert.ok(source);
  assert.match(source.text, /var _index: Dict\[String, Int32\]/u);
  assert.match(source.text, /for __tsonic_object_index_key_/u);
  assert.match(source.text, /\._state\[\]\._index\["first"\] \+= Int32\(4\)/u);
  assert.match(source.text, /\._state\[\]\._index\[name\]/u);
});

test("readonly project index signatures reject exact selected writes", () => {
  assert.throws(() => compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Scores { readonly [name: string]: i32; }",
        "function update(scores: Scores): void { scores.value = 1; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  }), /TS2542/u);
});

test("conditional callable values and callable fields retain one exact ABI", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Operation { run: (left: i32, right: i32) => i32; }",
        "function add(left: i32, right: i32): i32 { return left + right; }",
        "function subtract(left: i32, right: i32): i32 { return left - right; }",
        "function apply(condition: boolean): i32 {",
        "  const selected = condition ? add : subtract;",
        "  const operation: Operation = { run: selected };",
        "  return operation.run(4, 2);",
        "}",
        "export function main(): void { if (apply(true) !== 6 || apply(false) !== 2) return; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def apply"));
  assert.ok(source);
  assert.match(source.text, /Callable\[Tuple\[Int32, Int32\], Int32\]/u);
  assert.match(source.text, /operation\._state\[\]\.run\.call\(\(Int32\(4\), Int32\(2\)\)\)/u);
});

test("assertions consume the checker-selected narrowed union route", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        'interface Dog { kind: "dog"; name: string; }',
        'interface Cat { kind: "cat"; lives: i32; }',
        "type Pet = Dog | Cat;",
        "function name(pet: Pet): string {",
        '  if (pet.kind === "dog") return (pet as Dog).name;',
        '  return "cat";',
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def name"));
  assert.ok(source);
  assert.match(source.text, /return \(pet\[Dog\]\)\._state\[\]\.name/u);
});
