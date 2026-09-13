import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";
import { memoryAbiCapability } from "../../helpers/memory-abi.mjs";
import { nativeRecordProvider, nativeRecordSource } from "../../helpers/native-record-provider.mjs";

test("native record layout uses exact provider fields rather than source spellings", () => {
  const result = compileMojo({ capabilities: [memoryAbiCapability(), nativeRecordProvider()], files: { "index.ts": nativeRecordSource } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /require_native_field_count\[Header, 2\]/u);
  assert.match(emitted, /require_native_field\[Header, UInt8, "kind", 0\]/u);
  assert.match(emitted, /require_native_field\[Header, UInt32, "amount", 4\]/u);
  assert.doesNotMatch(emitted, /require_native_field\[[^\n]*"count"/u);
  assert.match(emitted, /var _raw_pointer: Optional\[RawPointer\] = raw\.copy\(\)/u);
  assert.doesNotMatch(emitted, /var _raw_pointer: Optional\[RawPointer\] = raw\^/u);
});

test("native field evidence rejects divergent accessors and incomplete physical inventories", () => {
  for (const mutation of [{ writableName: "another_field" }, { fieldKind: "method" }, { includeTag: false }]) {
    const result = compileMojo({ capabilities: [memoryAbiCapability(), nativeRecordProvider(mutation)], files: { "index.ts": nativeRecordSource } });
    assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_NATIVE_MEMORY_CONTRACT_NOT_PROVEN"));
    assert.equal(result.artifacts.length, 0);
  }
});

test("layout-backed scalar views preserve original storage and erase checked metadata", () => {
  const result = compileMojo({ capabilities: [memoryAbiCapability()], files: { "index.ts": `
import { abi } from "test:abi";
import { memoryLayout, allocatePointer, loadPointer, storePointer, toRawPointer, reinterpretRawPointer, equalPointer, hashPointer, sizeOf, alignOf, strideOf, unsafeContext, keepAlive } from "@tsonic/core/lang.js";
import type { uint32, Pointer } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
function pass(pointer: Pointer<uint32>): Pointer<uint32> { return pointer; }
export function main(): void {
  unsafeContext();
  const original = allocatePointer<uint32>(31);
  const raw = toRawPointer(pass(original), word);
  const view = reinterpretRawPointer(raw, word);
  if (view === undefined) throw new Error("missing view");
  storePointer(view, 39);
  if (loadPointer(original) !== 39 || !equalPointer(original, view) || hashPointer(original) !== hashPointer(view)) throw new Error("alias");
  if (sizeOf(word) !== 4 || alignOf(word) !== 4 || strideOf(word) !== 4) throw new Error("layout");
  keepAlive(original);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /reinterpret_location\[UInt32, 4, 4, 4, 64, True\]/u);
  assert.match(emitted, /to_raw_location/u);
  assert.doesNotMatch(emitted, /memoryLayout|test:abi|var word\b/u);
});

test("address integers stay exact beyond the floating point integer range", () => {
  const result = compileMojo({ capabilities: [memoryAbiCapability()], files: { "index.ts": `
import { abi } from "test:abi";
import { addressIntegerToRawPointer, rawPointerToAddressInteger, offsetRawPointer } from "@tsonic/core/lang.js";
import type { uint64, int64 } from "@tsonic/core/types.js";
export function main(): void {
  const bits: uint64 = 9007199254740993n;
  const delta: int64 = -4n;
  const raw = addressIntegerToRawPointer(bits, abi);
  const shifted = offsetRawPointer(raw, delta, abi);
  if (rawPointerToAddressInteger<uint64>(shifted, abi) !== 9007199254740989n) throw new Error("integer");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /raw_from_address\[64\]/u);
  assert.match(emitted, /offset_raw_signed\[64\]/u);
  assert.doesNotMatch(emitted, /Float64\(9007199254740993/u);
});

test("memory descriptors cannot become runtime values and logical accessors are not native backing", () => {
  for (const body of [
    `export function main(): void { console.log(word); }`,
    `export function main(): void { const owner = { value: 1 as uint32 }; const pointer = bindPointer<uint32>(owner, () => owner.value, value => { owner.value = value; }); toRawPointer(pointer, word); }`,
  ]) {
    const result = compileMojo({ surfaces: ["js"], capabilities: [memoryAbiCapability()], files: { "index.ts": `
import { abi } from "test:abi";
import { memoryLayout, bindPointer, toRawPointer } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
${body}
` } });
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.artifacts.length, 0);
  }
});
