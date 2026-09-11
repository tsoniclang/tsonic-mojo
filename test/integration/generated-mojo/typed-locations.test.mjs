import assert from "node:assert/strict";
import test from "node:test";

test("closed native array element locations preserve all aliases and escape without JS storage", () => {
  const result = compileMojo({ files: { "index.ts": `
import { addressOf, loadPointer, storePointer, equalPointer } from "@tsonic/core/lang.js";
import type { Pointer, int32 } from "@tsonic/core/types.js";
function escaped(): Pointer<int32> {
  let values: int32[] = [1, 2];
  const alias = values;
  const pointer = addressOf(alias[1]);
  storePointer(pointer, 7);
  if (values[1] !== 7 || !equalPointer(pointer, addressOf(values[1]))) throw new Error("alias");
  values = [8, 9];
  if (loadPointer(pointer) !== 7 || values[1] !== 9) throw new Error("replacement");
  return pointer;
}
export function main(): void {
  const pointer = escaped();
  storePointer(pointer, 11);
  if (loadPointer(pointer) !== 11) throw new Error("escape");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /NativeArray\[Int32\]/u);
  assert.match(emitted, /\.location\(/u);
  assert.doesNotMatch(emitted, /tsonic_js/u);
});
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("typed locations preserve optional identity, generic pointees and reversible projections", () => {
  const result = compileMojo({ files: { "index.ts": `
import { allocatePointer, equalPointer, hashPointer, projectPointer, loadPointer, storePointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
function hash<T>(pointer: Pointer<T> | undefined): number { return hashPointer(pointer); }
function replace<T>(pointer: Pointer<T>, value: T): T { storePointer(pointer, value); return loadPointer(pointer); }
function shift(pointer: Pointer<int32> | undefined): Pointer<int32> | undefined {
  return projectPointer<int32, int32>(pointer, value => value + 1, value => value - 1);
}
export function main(): void {
  const pointer = allocatePointer<int32>(3);
  const projected = shift(pointer)!;
  if (!equalPointer(pointer, projected) || hash(pointer) !== hash(projected)) throw new Error("identity");
  if (replace(projected, 9) !== 9 || loadPointer(pointer) !== 8) throw new Error("projection");
  if (shift(undefined) !== undefined || hash<int32>(undefined) !== 0) throw new Error("optional");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /TypedLocation\[Int32\]/u);
  assert.match(emitted, /project_optional_location/u);
  assert.match(emitted, /hash_typed_location/u);
});

test("generic storage arguments cannot unify different exact pointee carriers", () => {
  const result = compileMojo({ files: { "index.ts": `
import { allocatePointer, loadPointer, storePointer } from "@tsonic/core/lang.js";
import type { int32, uint32, Pointer } from "@tsonic/core/types.js";
function assign<T>(destination: Pointer<T>, source: Pointer<T>): void {
  storePointer(destination, loadPointer(source));
}
export function main(): void {
  const signed = allocatePointer<int32>(1);
  const unsigned = allocatePointer<uint32>(2);
  assign(signed, unsigned);
}
` } });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_PROJECT_CALL_TYPE_ARGUMENT_NOT_CLOSED"));
});

test("bound locations retain a selected reference owner and escaped callbacks", () => {
  const result = compileMojo({ files: { "index.ts": `
import { bindPointer as bind, loadPointer, storePointer, hashPointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
class Owner { value: int32 = 0; }
function make(value: int32): Pointer<int32> {
  const owner = new Owner();
  let retained = value;
  return bind<int32>(owner, () => retained, next => { retained = next; });
}
export function main(): void {
  const pointer = make(3);
  const alias = pointer;
  storePointer(alias, 7);
  if (loadPointer(pointer) !== 7 || hashPointer(pointer) !== hashPointer(alias)) throw new Error("retention");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactTexts(result).map(({ text }) => text).join("\n"), /bind_location/u);
});

test("a same-spelled local pointer helper does not acquire a marker operation", () => {
  const result = compileMojo({ files: { "index.ts": `
function hashPointer(value: number): number { return value + 1; }
export function main(): void { if (hashPointer(2) !== 3) throw new Error("ordinary function"); }
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactTexts(result).map(({ text }) => text).join("\n"), /hash_typed_location/u);
});

test("a readonly location and incompatible projection remain rejected", () => {
  for (const body of [
    `const object: { readonly value: int32 } = { value: 1 }; addressOf(object.value);`,
    `const pointer = allocatePointer<int32>(1); projectPointer<int32, string>(pointer, value => value, value => value);`,
  ]) {
    assert.throws(() => compileMojo({ files: { "index.ts": `
import { addressOf, allocatePointer, projectPointer } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
export function main(): void { ${body} }
` } }), /TypeScript diagnostics:/u);
  }
});

test("field locations retain their original owner across reassignment and escape", () => {
  const result = compileMojo({ files: { "index.ts": `
import { addressOf, loadPointer, storePointer, equalPointer, hashPointer } from "@tsonic/core/lang.js";
import type { int32, Pointer } from "@tsonic/core/types.js";
class Pair { left: int32 = 1; right: int32 = 2; }
function left(pair: Pair): Pointer<int32> { return addressOf((pair.left)); }
function escaped(): Pointer<int32> { const pair = new Pair(); return left(pair); }
export function main(): void {
  let pair = new Pair();
  const old = pair;
  const first = left(pair);
  const second = addressOf(pair.left);
  pair = new Pair();
  storePointer(first, 9);
  if (old.left !== 9 || pair.left !== 1 || loadPointer(second) !== 9) throw new Error("owner");
  if (!equalPointer(first, second) || hashPointer(first) !== hashPointer(second)) throw new Error("identity");
  if (equalPointer(first, addressOf(old.right))) throw new Error("field identity");
  const retained = escaped(); storePointer(retained, 7);
  if (loadPointer(retained) !== 7) throw new Error("escape");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /access_location/u);
  assert.match(emitted, /\.member\(/u);
});

test("array locations evaluate owner and index once and retain the original array", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
import { addressOf, loadPointer, storePointer, equalPointer } from "@tsonic/core/lang.js";
import type { int32 } from "@tsonic/core/types.js";
export function main(): void {
  let values: int32[] = [3, 4];
  const old = values;
  let calls: int32 = 0;
  let index: int32 = 0;
  const select = (): int32[] => { calls++; return values; };
  const first = addressOf(select()[index++]);
  const same = addressOf(values[0]);
  values = [7, 8];
  old.push(5, 6);
  storePointer(first, 9);
  if (calls !== 1 || index !== 1 || old[0] !== 9 || values[0] !== 7) throw new Error("evaluation");
  if (loadPointer(same) !== 9 || !equalPointer(first, same)) throw new Error("alias");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(artifactTexts(result).map(({ text }) => text).join("\n"), /array_location/u);
});
