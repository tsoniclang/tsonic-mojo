import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const i32 = 'import type { int32 } from "@tsonic/core/types.js";';

function generatedModule(result) {
  return artifactTexts(result).find(({ path }) => path.includes("tsonic_generated"))?.text ?? "";
}

test("top-level overload calls use exact contract adapters around one implementation", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
function value(input: int32): int32;
function value(input: string): string;
function value(input: int32 | string): int32 | string { return input; }
export function main(): void { value(1); value("text"); }`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.equal((source.match(/^def value\(/gmu) ?? []).length, 1);
  assert.match(source, /def _value_overload\(input: Int32\) -> Int32:/u);
  assert.match(source, /def _value_overload_2\(input: String\) -> String:/u);
  assert.match(source, /value\(Variant\[String, Int32\]\(input\)\)/u);
  assert.match(source, /_value_overload\(Int32\(1\)\)/u);
  assert.match(source, /_value_overload_2\("text"\)/u);
});

test("instance and static method overloads share the callable adapter model", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Values {
  read(input: int32): int32;
  read(input: string): string;
  read(input: int32 | string): int32 | string { return input; }
  static parse(input: int32): int32;
  static parse(input: string): string;
  static parse(input: int32 | string): int32 | string { return input; }
}
export function main(): void {
  const values = new Values();
  values.read(1);
  values.read("text");
  Values.parse(2);
  Values.parse("more");
}`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /def _read_overload\(self, input: Int32\) -> Int32:/u);
  assert.match(source, /def _read_overload_2\(self, input: String\) -> String:/u);
  assert.match(source, /@staticmethod\n\s+def _parse_overload\(input: Int32\) -> Int32:/u);
  assert.match(source, /@staticmethod\n\s+def _parse_overload_2\(input: String\) -> String:/u);
  assert.match(source, /values\._read_overload\(Int32\(1\)\)/u);
  assert.match(source, /Values\._parse_overload_2\("more"\)/u);
});

test("constructor overloads expose only selected native initializer contracts", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
class Value {
  constructor(input: int32);
  constructor(input: string);
  constructor(input: int32 | string) {}
}
export function main(): void { new Value(1); new Value("text"); }`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /struct _ValueState:[\s\S]*def __init__\(out self, input: Variant\[String, Int32\]\):/u);
  assert.match(source, /def __init__\(out self, input: Int32\):\n\s+self = _ValueState\(Variant\[String, Int32\]\(input\)\)/u);
  assert.match(source, /def __init__\(out self, input: String\):\n\s+self = _ValueState\(Variant\[String, Int32\]\(input\)\)/u);
  assert.doesNotMatch(source, /struct Value[\s\S]*def __init__\(out self, input: Variant\[String, Int32\]\)/u);
});

test("first-class overload references bind their selected contract instead of the wide implementation", () => {
  const result = compileMojo({
    files: {
      "index.ts": `${i32}
function value(input: int32): int32;
function value(input: string): string;
function value(input: int32 | string): int32 | string { return input; }
const integerValue: (input: int32) => int32 = value;
const stringValue: (input: string) => string = value;
export function main(): void { integerValue(1); stringValue("text"); }`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = generatedModule(result);
  assert.match(source, /var _value_overload_value: Optional\[Callable\[Tuple\[Int32\], Int32\]\]/u);
  assert.match(source, /var _value_overload_2_value: Optional\[Callable\[Tuple\[String\], String\]\]/u);
  assert.match(source, /return _value_overload\(_value_overload_callable_arguments\[0\]\)/u);
  assert.match(source, /return _value_overload_2\(_value_overload_2_callable_arguments\[0\]\)/u);
  assert.doesNotMatch(source, /\]\(value\)\n/u);
});
