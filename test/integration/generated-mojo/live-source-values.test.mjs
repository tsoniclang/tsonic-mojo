import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generated(source) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).filter(({ path }) => path.endsWith(".mojo")).map(({ text }) => text).join("\n");
}

test("unknown assignments retain their source owner rather than snapshotting fields", () => {
  const output = generated(`
class Counter { count = 1; }
function preserve(value: unknown): unknown { return value; }
export function main(): void {
  const counter = new Counter();
  const first: unknown = counter;
  const second = preserve(counter);
  counter.count = 2;
  console.log(first, second);
  JSON.stringify(first);
  Object.is(first, second);
  counter.hasOwnProperty("count");
}
`);
  assert.match(output, /js_value_from_source_object\(/u);
  assert.match(output, /WeakReferenceIdentity\(/u);
  assert.match(output, /object_has_own\(/u);
  assert.doesNotMatch(output, /js_value_from_object_entries|js_value_from_json_projection/u);
  assert.equal((output.match(/js_value_from_source_object\(/gu) ?? []).length, 1);
});

test("recursive selected source carriers close into finite generated view functions", () => {
  const output = generated(`
class Link { value = 1; next: Link | undefined = undefined; }
export function main(): void {
  const head = new Link(); head.next = head;
  const saved: unknown = head;
  console.log(saved);
  try { JSON.stringify(saved); } catch { console.log("cycle"); }
}
`);
  assert.match(output, /js_value_from_source_object\(/u);
  assert.ok(output.length < 40000, `A recursive source view expanded to ${output.length} characters`);
  assert.equal((output.match(/js_value_from_source_object\(/gu) ?? []).length, 1);
});

test("source array views carry index presence and selected class JSON remains independent", () => {
  const output = generated(`
class Counter { count = 1; toJSON(): number { return this.count; } }
export function main(): void {
  const counter = new Counter();
  const values = [counter];
  const saved: unknown = values;
  counter.count = 2;
  JSON.stringify(saved);
  Object.keys(counter);
  console.log(counter);
}
`);
  assert.match(output, /js_value_from_source_array\(/u);
  assert.match(output, /js_value_from_source_object\(/u);
  assert.match(output, /def has\(/u);
  assert.match(output, /def to_json\(/u);
  assert.doesNotMatch(output, /js_value_from_json_projection|js_value_from_array_values/u);
});

test("source view helpers declare phantom generic parameters without adding constraints", () => {
  const output = generated(`
class Token<T> { count = 1; }
function box<T>(value: Token<T>): unknown { return value; }
export function main(): void {
  const token = new Token<number>();
  const saved = box(token);
  token.count = 3;
  JSON.stringify(saved);
}
`);
  assert.match(output, /js_value_from_source_object\(/u);
  assert.match(output, /SourceValueView/u);
  assert.doesNotMatch(output, /runtime_reflect|type_of_name/u);
});

test("only ECMAScript private fields are excluded from a class own-property view", () => {
  const output = generated(`
class Counter {
  #secret = 1;
  count: number | undefined = undefined;
  read(): number { return this.#secret; }
}
export function main(): void {
  const counter = new Counter();
  Object.keys(counter);
  console.log(counter.read());
}
`);
  assert.match(output, /JsString\("count"\)/u);
  assert.doesNotMatch(output, /JsString\("#secret"\)/u);
});

test("base-typed live views select concrete own fields through sealed project dispatch", () => {
  const output = generated(`
class Base { first = 1; }
class Middle extends Base { middle = 2; }
class Leaf extends Middle { last = 3; }
function retain(value: Base): unknown { return value; }
export function main(): void {
  const leaf = new Leaf();
  const saved = retain(leaf);
  leaf.last = 4;
  JSON.stringify(saved);
  Object.is(saved, retain(leaf));
}
`);
  assert.match(output, /try_as_Leaf\(/u);
  assert.match(output, /WeakReferenceIdentity|weak_identity/u);
  assert.match(output, /JsString\("last"\)/u);
  assert.doesNotMatch(output, /js_value_from_object_entries/u);
});

test("JSON property lists retain exact inherited getter calls independently of own fields", () => {
  const output = generated(`
class Options {
  own = 1;
  reads = 0;
  get inherited(): number { this.reads += 1; return 2; }
}
export function main(): void {
  const options = new Options();
  Object.keys(options);
  JSON.stringify(options);
  JSON.stringify(options, ["inherited", "own", "inherited"], 2);
  JSON.stringify(options, ["own"], " ");
}
`);
  assert.match(output, /json_stringify_with_property_list_and_space_number\(/u);
  assert.match(output, /json_stringify_with_property_list_and_space_string\(/u);
  assert.match(output, /def property_reader\(/u);
  assert.match(output, /JsString\("inherited"\)/u);
});
