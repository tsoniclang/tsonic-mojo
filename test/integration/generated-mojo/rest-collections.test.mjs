import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generated(body) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": body } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).filter(({ path }) => path.endsWith(".mojo"))
    .map(({ text }) => text).join("\n");
}

test("array rest arguments use one collection call for empty single and multiple inputs", () => {
  const source = generated(`
    export function main(): void {
      const values: string[] = [];
      values.push(); values.push("a"); values.push("b", "c");
      values.unshift("head"); values.splice(1); values.splice(1, 0, "middle");
    }
  `);
  assert.equal((source.match(/\.push\(/gu) ?? []).length, 3);
  assert.match(source, /\.push\(values=List\[String\]\(\)\)/u);
  assert.match(source, /\.push\(values=\["a"\]\)/u);
  assert.match(source, /\.push\(values=\["b", "c"\]\)/u);
  assert.match(source, /\.splice\([^\n]*items=List\[String\]\(\)/u);
  assert.doesNotMatch(source, /\.push\(\*/u);
});

test("generic borrowed strings retain their selected element carrier", () => {
  const source = generated(`
    function insert<T>(values: T[], value: T): number { return values.push(value); }
    export function main(): void { insert<string>([], "header.html"); }
  `);
  assert.match(source, /def insert\[T: Copyable & Deinitable\]/u);
  assert.match(source, /\.push\(values=\[value\.copy\(\)\]\)/u);
  assert.doesNotMatch(source, /\.push\(value\)/u);
});

test("variadic string numeric and console operations use explicit collections", () => {
  const source = generated(`
    export function main(): void {
      "a".concat("b", "c"); String.fromCharCode(65, 66); String.fromCodePoint(65);
      Math.max(); Math.min(1, 2); Math.hypot(3, 4); console.log("value", 1);
      new Array<string>("a", "b");
    }
  `);
  for (const [name, argument] of [
    ["native_string_concat", "others"], ["native_string_from_char_code", "codes"],
    ["native_string_from_code_point", "codes"], ["math_max", "values"],
    ["math_min", "values"], ["math_hypot", "values"], ["console_log", "data"],
    ["array_new", "items"],
  ]) assert.match(source, new RegExp(`${name}(?:\\[[^\\]]+\\])?\\([\\s\\S]*?${argument}=`, "u"));
});

test("rest collection spread and optional calls remain inside their evaluation regions", () => {
  const source = generated(`
    function insert(values: string[] | undefined, input: string[]): number | undefined {
      return values?.push(...input, "tail");
    }
    export function main(): void { insert(undefined, ["a"]); insert([], ["b"]); }
  `);
  assert.match(source, /for \w+ in .*iter_values\(\)/u);
  assert.match(source, /\.push\(values=\w+\)/u);
  assert.doesNotMatch(source, /\.push\([^)]*\*/u);
});

test("ordinary project methods are not classified as runtime collection operations by spelling", () => {
  const source = generated(`
    class Counter { push(first: number, second: number): number { return first - second; } }
    export function main(): void { new Counter().push(4, 2); }
  `);
  assert.doesNotMatch(source, /\.push\(values=/u);
});

test("data rest arguments retain heterogeneous conversions and typed spread materialization", () => {
  const source = generated(`
    export function main(): void {
      const pair: [string, boolean] = ["label", true];
      const values: number[] = [1, 2];
      console.log("prefix", 3, false, ...pair, ...values, "suffix");
    }
  `);
  assert.match(source, /console_log\(data=/u);
  assert.match(source, /js_value_from_number\(/u);
  assert.match(source, /js_value_from_bool\(/u);
  assert.match(source, /\.get\(\w+\)/u);
  assert.match(source, /js_value_from_undefined\(\)/u);
  assert.doesNotMatch(source, /console_log\([^\n]*\*/u);
});
