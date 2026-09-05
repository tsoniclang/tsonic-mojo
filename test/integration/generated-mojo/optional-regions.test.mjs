import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function compile(source, surfaces = []) {
  const result = compileMojo({ surfaces, files: {
    "index.ts": `${source}\nexport function main(): void {}`,
  } });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main("));
  assert.ok(generated);
  return generated.text;
}

const cases = [
  ["project field", `
interface Box { value: number; }
export function read(box: Box | undefined): number { return box?.value ?? -1; }
`],
  ["nested project fields", `
interface Leaf { value: number; }
interface Box { leaf?: Leaf; }
export function read(box: Box | undefined): number { return box?.leaf?.value ?? -1; }
`],
  ["project method", `
class Box { add(value: number): number { return value + 1; } }
export function read(box: Box | undefined, next: () => number): number {
  return box?.add(next()) ?? -1;
}
`],
  ["element access", `
export function read(box: number[] | undefined, index: () => number): number {
  return box?.[index()] ?? -1;
}
`],
];

for (const surfaces of [[], ["js"]]) {
  for (const [name, source] of cases) {
    test(`optional ${name} narrows only inside its guard on ${surfaces.length === 0 ? "native" : "JS"} profile`, () => {
      const generated = compile(source, surfaces);
      assert.match(generated, /if _optional_receiver/u);
      assert.doesNotMatch(generated, /= box\.value\(\)/u);
      if (name === "element access" && surfaces.length === 0) {
        assert.match(generated, /= box\.copy\(\)\n/u);
        assert.match(generated, /ref _optional_value = _optional_receiver\.value\(\)/u);
      } else {
        assert.match(generated, /= box\n/u);
      }
    });
  }
}

test("actual source guards still narrow a present project receiver", () => {
  const generated = compile(`
interface Box { value: number; }
export function read(box: Box | undefined): number {
  if (box === undefined) return -1;
  return box.value;
}
`);
  assert.match(generated, /box\.value\(\)/u);
});

test("present object arguments enter optional parameters through exactly one conversion", () => {
  const generated = compile(`
interface Box { value: number; }
function read(box: Box | undefined): number { return box?.value ?? -1; }
export function run(): number { return read({ value: 5 }); }
`);
  const compact = generated.replace(/\s+/gu, "");
  assert.match(compact, /Optional\[Box,?\]\(Box\(Float64\(5\)\)\)/u);
  assert.doesNotMatch(compact, /Optional\[Box,?\]\(Optional\[Box/u);
});

test("transparent unsafe expressions retain the selected native pointee carrier", () => {
  const generated = compile(`
import { offsetNativePointer, loadNativePointer, unsafeContext } from "@tsonic/core/lang.js";
import type { NativePointer, uint8, nativeInt } from "@tsonic/core/types.js";
export function offset(pointer: NativePointer<uint8>, amount: nativeInt): NativePointer<uint8> {
  return unsafeContext(offsetNativePointer(pointer, amount));
}
export function read(pointer: NativePointer<uint8>): uint8 {
  return unsafeContext(loadNativePointer(pointer));
}
`);
  assert.match(generated, /Pointer\[UInt8, MutUnsafeAnyOrigin\]/u);
  assert.match(generated, /pointer\.unsafe_offset\(amount\)/u);
  assert.doesNotMatch(generated, /Float64/u);
});

test("native callable locals keep their sealed representation instead of erased annotations", () => {
  const generated = compile(`
export function callables(seed: number): number {
  let value = seed;
  const direct = (argument: number): number => argument + 1;
  const count = (): number => value;
  const mutate = (): number => { value += 2; return value; };
  return direct(count()) + mutate();
}
`);
  assert.match(generated, /var direct = /u);
  assert.match(generated, /var count = lambda/u);
  assert.match(generated, /var mutate: Callable\[/u);
  assert.doesNotMatch(generated, /var (?:direct|count): Callable/u);
});
