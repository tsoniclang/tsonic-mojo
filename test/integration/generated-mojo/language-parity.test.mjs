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
  assert.match(
    setup.text,
    /\.initialized = Optional\[Int32\]\(Int32\(1\)\)[\s\S]*\.initialized\.value\(\) \+= Int32\(1\)/u,
  );
  assert.match(entry.text, /_initialize_module/u);
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
  assert.match(value.text, /async def _initialize_module/u);
  assert.match(value.text, /await create_task\(load\(\)\)/u);
  assert.match(entry.text, /create_task\(_async_entry\(\)\)\.wait\(\)/u);
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
  const slots = source.text.match(/counter_total/g) ?? [];
  assert.ok(slots.length >= 4);
  assert.match(source.text, /counter_total\.value\(\) \+= Int32\(2\)/u);
  assert.match(source.text, /counter_total\.value\(\) \+= Int32\(3\)/u);
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
  assert.match(source.text, /comptime OFF: Mode = Mode\(0\)/u);
  assert.match(source.text, /comptime ON: Mode = Mode\(4\)/u);
  assert.match(source.text, /def consume\(selected: Mode\)/u);
  assert.match(source.text, /if selected == Mode\.OFF:/u);
});

test("synchronous runtime module cycles initialize their external dependencies exactly once", () => {
  const result = compileMojo({
    files: {
      "a.ts": 'import "./b.js"; export function a(): void {}',
      "b.ts": 'import "./a.js"; import "./state.js"; export function b(): void {}',
      "state.ts": 'import type { i32 } from "@tsonic/mojo/types.js"; export let value: i32 = 1;',
      "index.ts": 'import "./a.js"; export function main(): void {}',
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = artifactTexts(result);
  const owner = sources.find(({ text }) =>
    text.includes("def _initialize_module") && text.includes("state_initialize_module"));
  const state = sources.find(({ text }) =>
    text.includes("var value: Optional[Int32]") && text.includes("_lifecycle_initialized"));
  const entry = sources.find(({ path }) => path.endsWith("main.mojo"));
  assert.ok(owner);
  assert.ok(state);
  assert.ok(entry);
  assert.match(owner.text, /state_initialize_module\(\)/u);
  assert.match(state.text, /_lifecycle_initialized = True/u);
  assert.match(entry.text, /_initialize_entry\(\)/u);
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
  const entry = artifactTexts(result).find(({ text }) =>
    text.includes("def tsonic_main") && text.includes("load_count()"));
  assert.ok(settings);
  assert.ok(entry);
  assert.equal((settings.text.match(/load\(\)/gu) ?? []).length, 2);
  assert.match(settings.text, /default_export/u);
  assert.match(entry.text, /_module_state\.get\(\)\[\]\.default_export\.value\(\)/u);
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
  assert.match(source.text, /def identity\[T: ImplicitlyCopyable & Deinitable\]\(value: T\) -> T/u);
  assert.match(source.text, /return value/u);
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
  const source = artifactTexts(result).find(({ text }) => text.includes("struct _CounterState"));
  assert.ok(source);
  assert.match(source.text, /struct _CounterState/u);
  assert.match(source.text, /var _value: Int32/u);
  assert.match(source.text, /struct Counter\(ImplicitlyCopyable, Equatable\)[\s\S]*ArcPointer\[_CounterState\]/u);
  assert.doesNotMatch(source.text, /#value/u);
});

test("project construction selects the exact authored constructor signature", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class Counter {",
        "  value: i32 = 0;",
        "  constructor(value: i32) { this.value = value; }",
        "}",
        "export function main(): void { const counter = new Counter(7); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct Counter"));
  assert.ok(source);
  assert.match(source.text, /def __init__\(out self, value: Int32\)/u);
  assert.match(source.text, /Counter\(Int32\(7\)\)/u);
});

test("constructor-owned field initialization closes reference state without target defaults", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class Pair {",
        "  left: i32;",
        "  right: string;",
        "  constructor(left: i32, right: string) {",
        "    this.left = left;",
        "    this.right = right;",
        "  }",
        "}",
        'export function main(): void { const pair = new Pair(7, "seven"); }',
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct _PairState"));
  assert.ok(source);
  assert.match(source.text, /def __init__\(out self, left: Int32, right: String\):[\s\S]*self\.left = left[\s\S]*self\.right = right/u);
  assert.match(source.text, /_PairState\(left, right\)/u);
  assert.doesNotMatch(source.text, /_(?:left|right)_initial_/u);
  assert.doesNotMatch(source.text, /self\.(?:left|right) = (?:Int32\(Float64\(0\)\)|"")/u);
  assert.doesNotMatch(source.text, /self\._state\[\]\.(?:left|right) =/u);
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
  assert.match(source.text, /_switch_value/u);
  assert.match(source.text, /_switch_clause/u);
  assert.match(source.text, /while True:/u);
  assert.match(source.text, /total \+= Int32\(1\)[\s\S]*total \+= Int32\(2\)/u);
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
  assert.match(entry.text, /create_task\(_async_entry\(\)\)\.wait\(\)/u);
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
  const source = artifactTexts(result).find(({ text }) => text.includes("struct _PairState"));
  assert.ok(source);
  assert.match(source.text, /struct _PairState\[T: Movable & Deinitable\]/u);
  assert.match(source.text, /struct Pair\[T: Movable & Deinitable\][\s\S]*ArcPointer\[_PairState\[Self\.T\]\]/u);
  assert.match(source.text, /Pair\[Int32\]\(/u);
  assert.match(source.text, /_object_spread/u);
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
  assert.match(source.text, /var values: List\[Int32\] = \[Int32\(1\), Int32\(2\)\]/u);
  assert.match(source.text, /var tuple: Tuple\[Int32, String\] = \(Int32\(3\), "three"\)/u);
  assert.match(source.text, /var bytes: Array\[UInt8, 2\] = Array\[UInt8, 2\]\(UInt8\(4\), UInt8\(5\)\)/u);
  assert.match(
    source.text,
    /return Int32\(Float64\(values\[Int\(0\)\] \+ tuple\[0\]\) \+ Float64\(bytes\[Int\(1\)\]\)\)/u,
  );
});

test("contextual array literals select the exact present aggregate from an optional target", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        "export function main(): void {",
        "  let values: number[] | undefined = undefined;",
        "  if (values === undefined) values = [];",
        "  values.push(1);",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  assert.match(source.text, /Optional\[JsArray\[Float64\]\]/u);
  assert.match(source.text, /Optional\[JsArray\[Float64\]\]\(JsArray\[Float64\]\(\[\]\)\)/u);
});

test("collection conversions seal their intermediate lifecycle carriers", () => {
  const result = compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class State {",
        "  values: i32[];",
        "  constructor() { this.values = [0]; }",
        "}",
        "export function main(): void { new State(); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct State"));
  assert.ok(source);
  assert.match(source.text, /var _conversion_result: List\[Int32\] = \[\]/u);
  assert.match(source.text, /JsArray\[Int32\]\(_conversion_result\^\)/u);
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
  assert.match(source.text, /return \(Int64\(-1\), UInt64\(2\)\)/u);
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
    code === "MOJO_CALLABLE_PARAMETER_CARRIER_UNRESOLVED" && message.includes("decimal")));
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
  assert.match(source.text, /if _optional_receiver_/u);
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
  assert.match(source.text, /transform: RaisingCallable\[Tuple\[Int32\], Int32, Error\]/u);
  assert.match(source.text, /widen_callable\[Tuple\[Int32\], Int32, Error\]\(double\)/u);
  assert.match(source.text, /transform\.call\(\(value,\)\)/u);
  assert.match(source.text, /struct _callable_environment:/u);
  assert.match(source.text, /var \(value,\) = _callable_environment_arguments/u);
  assert.match(source.text, /return value \+ value/u);
  assert.equal((source.text.match(/= allocate_callable_environment\(/gu) ?? []).length, 1);
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
  assert.match(source.text, /lambda \(value: Int32\) \{imm offset\} -> Int32: value \+ offset/u);
  assert.doesNotMatch(source.text, /allocate_callable_environment|_callable_environment/u);
});

test("const-function and imported callable-value parameters retain their exact callback ABI", () => {
  const result = compileMojo({ files: {
    "invoke.ts": [
      "export const invoke = (action: (value: string) => string): string => action('value');",
    ].join("\n"),
    "index.ts": [
      "import { invoke } from './invoke.js';",
      "const local = (action: (value: string) => string): string => action('local');",
      "export function main(): void {",
      "  const prefix = 'prefix';",
      "  invoke(value => prefix + value);",
      "  local(value => value);",
      "}",
    ].join("\n"),
  } });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(generated);
  assert.equal((generated.text.match(/= allocate_callable_environment\(/gu) ?? []).length, 2);
  assert.match(generated.text, /RaisingCallable\[/u);
  assert.doesNotMatch(generated.text, /lambda |def _callable\(/u);
});

test("retained closures preserve statement conversions inside their erased callable environment", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "function apply(transform: (message: string) => number | undefined): number | undefined {",
        '  return transform("value");',
        "}",
        "function select(line?: i32): number | undefined {",
        "  return apply((_message: string): number | undefined => line);",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def select"));
  assert.ok(source);
  assert.match(source.text, /struct _callable_environment:/u);
  assert.match(source.text, /RaisingCallable\[/u);
  assert.match(source.text, /def invoke\([\s\S]*\) raises Error -> Optional\[Float64\]:/u);
  assert.match(source.text, /var _optional_source: Optional\[[\s\S]*Int32,[\s\S]*\] = _callable_environment_pointer\[\]\.line/u);
  assert.match(source.text, /return _optional_result/u);
  assert.match(source.text, /allocate_callable_environment/u);
});

test("capture-free block-bodied callable expressions lower to one direct function", () => {
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
  const source = artifactTexts(result).find(({ text }) => text.includes("def _callable"));
  assert.ok(source);
  assert.match(source.text, /var value = _callable/u);
  assert.doesNotMatch(source.text, /var value: Callable/u);
  assert.match(source.text, /def _callable\(\) -> Int32:[\s\S]*return Int32\(1\)/u);
  assert.match(source.text, /_ = value\(\)/u);
  assert.doesNotMatch(source.text, /allocate_callable_environment|_callable_environment/u);
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
  assert.match(source.text, /total_location: Location\[Int32\]/u);
  assert.match(source.text, /_callable_environment\(total_location\)/u);
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
  assert.match(source.text, /var first: Int32 = values\[0\]/u);
  assert.match(source.text, /var second: Int32 = _binding_nested\._state\[\]\.right/u);
  assert.match(source.text, /var renamed: Int32 = _binding_source_2\._state\[\]\.right/u);
  assert.doesNotMatch(source.text, /Tuple\[Int32, Pair\[Int32\], Int32\] = values/u);
  assert.equal((source.text.match(/= make_pair\(\)/gu) ?? []).length, 1);
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
  assert.match(source.text, /if _binding_optional:/u);
  assert.match(source.text, /List\[Int32\]\(values\[1:\]\)/u);
  assert.match(source.text, /var tuple_tail: Tuple\[Int32, Int32\] = \(tuple\[1\], tuple\[2\]\)/u);
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

test("for await over an exact synchronous iterable lowers to native synchronous iteration", () => {
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
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("async def consume"));
  assert.ok(source);
  assert.match(source.text, /async def consume\(values: List\[Int32\]\):/u);
  assert.match(source.text, /for value in values:/u);
  assert.doesNotMatch(source.text, /await .*values/u);
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
        'import { equalRawPointer as equal, hashRawPointer } from "@tsonic/core/lang.js";',
        'import * as core from "@tsonic/core/lang.js";',
        'import type { RawPointer, float64 } from "@tsonic/core/types.js";',
        "export function same(first: RawPointer | undefined, second: RawPointer | undefined): boolean {",
        "  return equal(first, second);",
        "}",
        "export function hash(pointer: RawPointer | undefined): float64 {",
        "  return hashRawPointer(pointer);",
        "}",
        "export function absent(): boolean {",
        "  return core.equalRawPointer(undefined, undefined);",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def same"));
  assert.ok(generated);
  assert.match(generated.text, /Optional\[RawPointer\]/u);
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
  assert.match(generated.text, /area\(Shape\(Circle\("circle", Int32\(2\)\)\)\)/u);
  assert.match(generated.text, /\.isa\[Circle\]\(\)/u);
  assert.match(generated.text, /shape\.unsafe_get\[Circle\]\(\).*\.radius/u);
  assert.match(generated.text, /shape\.unsafe_get\[Square\]\(\).*\.side/u);

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
  assert.equal((source.text.match(/\.__len__\(\)/gu) ?? []).length, 1);
  assert.match(source.text, /source_string_length\(text\) >= Float64\(0\)/u);
  assert.match(source.text, /Float64\([^\n]*\.__len__\(\)\) <= Float64\(3\)/u);
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
  const source = artifactTexts(result).find(({ text }) => text.includes("struct _ScoresState"));
  assert.ok(source);
  assert.match(source.text, /var _index: Dict\[String, Int32\]/u);
  assert.match(source.text, /for _object_index_key in _object_spread\._state\[\]\._index\.keys\(\):/u);
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
  assert.match(source.text, /RaisingCallable\[Tuple\[Int32, Int32\], Int32, Error\]/u);
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
  assert.match(source.text, /return pet\.unsafe_get\[Dog\]\(\)\._state\[\]\.name/u);
});

test("assertions preserve checker narrowing for repeated property access", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "class NumberValue { value: i32; constructor(value: i32) { this.value = value; } }",
        "class TextValue { value: string; constructor(value: string) { this.value = value; } }",
        "class Field { value: NumberValue | TextValue; constructor(value: NumberValue | TextValue) { this.value = value; } }",
        "function read(field: Field): i32 {",
        '  if (!(field.value instanceof NumberValue)) throw new Error("number required");',
        "  const selected = field.value as NumberValue;",
        "  return selected.value;",
        "}",
        "export function main(): void { if (read(new Field(new NumberValue(7))) !== 7) throw new Error(\"bad\"); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def read"));
  assert.ok(source);
  assert.match(source.text, /field\._state\[\]\.value\.unsafe_get\[NumberValue\]\(\)/u);
});

test("cross-module project state access imports the exact owning state type", () => {
  const result = compileMojo({
    files: {
      "model.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "export class Box {",
        "  value: i32;",
        "  constructor(value: i32) { this.value = value; }",
        "}",
      ].join("\n"),
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        'import { Box } from "./model.js";',
        "export function read(box: Box): i32 { return box.value; }",
        "export function main(): void { read(new Box(7)); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def read"));
  assert.ok(source);
  assert.match(source.text, /from .*model import Box, _BoxState|from .*model import _BoxState, Box/u);
  assert.match(source.text, /box\._state\[\]\.value/u);
});

test("recursive class and interface state use finite construction factories", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class Leaf {",
        "  text: string;",
        "  constructor(text: string) { this.text = text; }",
        "}",
        "class Branch {",
        "  children: TreeNode[];",
        "  constructor(children: TreeNode[]) { this.children = children; }",
        "}",
        "type TreeNode = Leaf | Branch;",
        "interface Tree { children: Tree[]; }",
        "function branch(children: TreeNode[]): TreeNode { return new Branch(children); }",
        "function tree(children: Tree[]): Tree { return { children }; }",
        "export function main(): void { branch([]); tree([]); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct Branch"));
  assert.ok(source);
  assert.match(source.text, /struct Branch[\s\S]*var _state: SharedReference/u);
  assert.match(source.text, /def __init__\(out self, state: SharedReference\)/u);
  assert.match(source.text, /def _create_branch[\s\S]*-> Branch/u);
  assert.match(source.text, /def _create_tree[\s\S]*-> Tree/u);
  assert.match(source.text, /_create_branch\(children\)/u);
  assert.match(source.text, /return _create_tree\(/u);
});
