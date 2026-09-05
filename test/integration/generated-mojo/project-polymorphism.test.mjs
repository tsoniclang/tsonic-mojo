import assert from "node:assert/strict";
import test from "node:test";
import { substituteMojoTargetType } from "../../../dist/target-model/types/substitution.js";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const i32 = 'import type { i32 } from "@tsonic/mojo/types.js";';

function generatedModule(result) {
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  return source.text;
}

test("closed project inheritance emits exact base dispatch and erased downcast storage", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { value(): i32 { return 1; } }
class Derived extends Base { override value(): i32 { return 2; } }
export function main(): void {
  const value: Base = new Derived();
  value.value();
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /var _value_dispatch: def\(ProjectObject\) thin -> Int32/u);
  assert.match(source, /_downcast_Derived_dispatch: def\([\s\S]*ProjectObject[\s\S]*\) thin -> Optional\[\s*ProjectObject,?\s*\]/u);
  assert.doesNotMatch(source, /_downcast_Derived_dispatch: def\([\s\S]*\) thin -> Optional\[\s*Derived,?\s*\]/u);
  assert.match(source, /var value: Base = Derived\(\)\._as_Base\(\)/u);
  assert.match(source, /_ = value\.value\(\)/u);
});

test("an aliased type guard retains the exact selected receiver downcast", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { value(): i32 { return 1; } }
class Derived extends Base { override value(): i32 { return 2; } }
export function main(): void {
  const base: Base = new Derived();
  const derived = base instanceof Derived;
  if (derived) base.value();
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /if derived:\s+_ = base\.try_as_Derived\(\)\.value\(\)\.value_2\(\)/u);
});

test("a closed generic virtual call emits one exact dispatch specialization", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
export function main(): void {
  const base: Base = new Derived();
  base.identity<i32>(3);
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /var _identity_dispatch: def\(ProjectObject, Int32\) thin -> Int32/u);
  assert.match(source, /_implement_identity\[Int32\]\(value\)/u);
});

test("an open generic caller is specialized from its finite root use", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
function invoke<T>(base: Base, value: T): T { return base.identity<T>(value); }
export function main(): void {
  const value: i32 = invoke<i32>(new Derived(), 3);
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /def invoke_specialization_1\(base: Base, value: Int32\) -> Int32/u);
  assert.match(source, /invoke_specialization_1\(Derived\(\)\._as_Base\(\), Int32\(3\)\)/u);
  assert.doesNotMatch(source, /def invoke\[T:/u);
});

test("finite specialization propagates transitively and deduplicates repeated roots", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
function inner<T>(base: Base, value: T): T { return base.identity<T>(value); }
function outer<T>(base: Base, value: T): T { return inner<T>(base, value); }
export function main(): void {
  outer<i32>(new Derived(), 1);
  outer<i32>(new Derived(), 2);
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.equal((source.match(/def inner_specialization_1\(/gu) ?? []).length, 1);
  assert.equal((source.match(/def outer_specialization_1\(/gu) ?? []).length, 1);
  assert.equal((source.match(/outer_specialization_1\(Derived\(\)\._as_Base\(\), Int32\(/gu) ?? []).length, 2);
});

test("distinct closed roots retain distinct callable and dispatch variants", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
function invoke<T>(base: Base, value: T): T { return base.identity<T>(value); }
export function main(): void {
  invoke<i32>(new Derived(), 1);
  invoke<string>(new Derived(), "one");
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.equal((source.match(/def invoke_specialization_[12]\(/gu) ?? []).length, 2);
  assert.match(source, /def invoke_specialization_[12]\(base: Base, value: Int32\) -> Int32/u);
  assert.match(source, /def invoke_specialization_[12]\(base: Base, value: String\) -> String/u);
  assert.match(source, /def\(\s*ProjectObject,\s*Int32,\s*\) thin -> Int32/u);
  assert.match(source, /def\(\s*ProjectObject,\s*String,\s*\) thin -> String/u);
});

test("specialization closes generic arguments nested in aggregates and callables", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
function invoke<T>(base: Base, value: T): T { return base.identity<T>(value); }
function one(): i32 { return 1; }
export function main(): void {
  invoke<i32[]>(new Derived(), [1]);
  invoke<i32 | undefined>(new Derived(), undefined);
  invoke<() => i32>(new Derived(), one);
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.equal((source.match(/def invoke_specialization_[123]\(/gu) ?? []).length, 3);
  assert.match(source, /value: List\[Int32\]/u);
  assert.match(source, /value: Optional\[Int32\]/u);
  assert.match(source, /value: RaisingCallable\[Tuple\[\], Int32, Error\]/u);
});

test("interface heritage seals inherited property and method dispatch", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
interface Parent { value: i32; }
interface Child extends Parent { next(): i32; }
class Counter implements Child {
  value: i32 = 1;
  next(): i32 { return this.value + 1; }
}
export function main(): void {
  const counter: Child = new Counter();
  counter.value + counter.next();
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /struct Child\(Equatable, ImplicitlyCopyable\)/u);
  assert.match(source, /def get_value\(self\) -> Int32/u);
  assert.match(source, /def next\(self\) -> Int32/u);
  assert.match(source, /Counter\(\)\._as_Child\(\)/u);
});

test("contextual methods and method spread preserve receiver-bearing behavior", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
interface Counter { value: i32; next(): i32; }
const first: Counter = { value: 1, next(): i32 { return this.value + 1; } };
const derived: Counter = { ...first, value: 2 };
export function main(): void { derived.next(); }`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /object_spread/u);
  assert.match(source, /_implement_next/u);
  assert.match(source, /derived\.value\(\)\.next\(\)/u);
});

test("bound method values retain snapshots while later method writes update dispatch", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Counter { value: i32 = 1; next(): i32 { return this.value; } }
function replacement(): i32 { return 2; }
export function main(): void {
  const counter = new Counter();
  const saved = counter.next;
  counter.next = replacement;
  saved();
  counter.next();
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /bind_raising_project_callable/u);
  assert.match(source, /_write_next_method/u);
  assert.match(source, /saved\.call/u);
  assert.match(source, /replacement_value: Optional\[Callable\[Tuple\[\], Int32\]\]/u);
  assert.match(source, /widen_callable[\s\S]*replacement_value\.value\(\)/u);
  assert.match(source, /struct _replacement_callable/u);
  assert.match(source, /counter\.next\(\)/u);
});

test("overloaded contextual methods and accessors retain separate selected contracts", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
interface Parser {
  parse(value: string): string;
  parse(value: string, radix: i32): string;
  get count(): i32;
  set count(value: i32);
}
let stored: i32 = 0;
const parser: Parser = {
  parse(value: string, radix?: i32): string { return value; },
  get count(): i32 { return stored; },
  set count(value: i32) { stored = value; },
};
export function main(): void {
  parser.parse("3");
  parser.parse("3", 10);
  parser.count = 2;
  parser.count;
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /def parse\(self, value: String\) -> String/u);
  assert.match(source, /def parse_2\(self, value: String, radix: Int32\) -> String/u);
  assert.equal((source.match(/def _get_count\(self\) -> Int32/gu) ?? []).length, 1);
  assert.equal((source.match(/def _set_count\(self, value: Int32\)/gu) ?? []).length, 1);
});

test("for await over an exact synchronous iterable lowers to native synchronous iteration", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
export async function consume(values: i32[]): Promise<i32> {
  let total: i32 = 0;
  for await (const value of values) total += value;
  return total;
}
export function main(): void {}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /async def consume\(values: List\[Int32\]\) -> Int32/u);
  assert.match(source, /for value in values:/u);
  assert.doesNotMatch(source, /async for/u);
});

test("open library and unrooted closed-program specialization fail at exact boundaries", () => {
  const body = `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
export function invoke<T>(base: Base, value: T): T { return base.identity<T>(value); }`;
  const library = compileMojo({
    target: { id: "mojo", options: { outputType: "lib" } },
    files: { "index.ts": body },
  });
  assert.deepEqual(library.diagnostics.map(({ code }) => code), [
    "MOJO_OPEN_LIBRARY_CALLABLE_SPECIALIZATION_UNSUPPORTED",
  ]);
  const binary = compileMojo({
    files: { "index.ts": `${body}\nexport function main(): void {}` },
  });
  assert.deepEqual(binary.diagnostics.map(({ code }) => code), [
    "MOJO_SOURCE_CALLABLE_SPECIALIZATION_UNCLOSED",
  ]);
});

test("generic callable-expression specialization rejects one unsupported ownership boundary", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Base { identity<T>(value: T): T { return value; } }
class Derived extends Base {}
const invoke = function <T>(base: Base, value: T): T { return base.identity<T>(value); };
export function main(): void {}`,
    },
  });
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "MOJO_SOURCE_CALLABLE_SPECIALIZATION_SHAPE_UNSUPPORTED",
  ]);
});

test("target substitution never captures a same-spelled generic with another identity", () => {
  const replacement = Object.freeze({ kind: "source-primitive", name: "int32" });
  const substitutions = Object.freeze({
    types: new Map([["outer:T", replacement], ["T", replacement]]),
    values: new Map(),
    origins: new Map(),
    packs: new Map(),
  });
  assert.deepEqual(
    substituteMojoTargetType(
      Object.freeze({ kind: "type-parameter", name: "T", identity: "outer:T" }),
      substitutions,
    ),
    replacement,
  );
  assert.deepEqual(
    substituteMojoTargetType(
      Object.freeze({ kind: "type-parameter", name: "T", identity: "inner:T" }),
      substitutions,
    ),
    Object.freeze({ kind: "type-parameter", name: "T", identity: "inner:T" }),
  );
});
