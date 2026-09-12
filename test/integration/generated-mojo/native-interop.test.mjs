import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";
import { associatedProvider, associatedSource, borrowedProvider, borrowedSource, foreignProvider, foreignSource } from "../../helpers/native-interop-provider.mjs";

test("selected C ABI calls preserve fixed arguments and independently promoted variadic values", () => {
  const result = compileMojo({ capabilities: [foreignProvider()], files: { "index.ts": `${foreignSource}\nexport function main(): void {}` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /external_call\["native_probe", Float64, num_fixed_args=1\]/u);
  assert.match(output, /external_call\["native_fixed", Int32\]/u);
  assert.doesNotMatch(output, /external_call\["native_fixed", Int32, num_fixed_args/u);
  assert.doesNotMatch(output, /Float64\(exact\)/u);
});

for (const [name, source, code] of [
  ["unsafe region", 'import { probe } from "test:c-abi"; export function main(): void { probe(0); }', "MOJO_FOREIGN_CALL_UNSAFE_CONTEXT_REQUIRED"],
  ["object tail", 'import { probe } from "test:c-abi"; import { unsafeContext } from "@tsonic/core/lang.js"; export function main(): void { unsafeContext(); probe(1, { value: 3 }); }', "MOJO_C_VARIADIC_CARRIER_UNSUPPORTED"],
  ["string tail", 'import { probe } from "test:c-abi"; import { unsafeContext } from "@tsonic/core/lang.js"; export function main(): void { unsafeContext(); probe(1, "not a native pointer"); }', "MOJO_C_VARIADIC_CARRIER_UNSUPPORTED"],
  ["open spread", 'import { probe } from "test:c-abi"; import { unsafeContext } from "@tsonic/core/lang.js"; export function run(values: number[]): void { unsafeContext(); probe(1, ...values); } export function main(): void {}', "MOJO_C_VARIADIC_OPEN_SPREAD_UNSUPPORTED"],
]) test(`native C ABI rejects ${name} before publication`, () => {
  const result = compileMojo({ capabilities: [foreignProvider()], files: { "index.ts": source } });
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === code), JSON.stringify(result.diagnostics));
  assert.deepEqual(result.artifacts, []);
});

test("imported explicit origins retain reference identity through caller-local bindings", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, capabilities: [borrowedProvider()], files: { "index.ts": borrowedSource } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /ref alias_: Int32/u);
  assert.match(output, /borrow\[O\]/u);
  assert.match(output, /-> ref\[O\] Int32/u);
  assert.match(output, /from std.origin import ImmStaticOrigin/u);
  assert.match(output, /borrow\[ImmStaticOrigin\]/u);
  assert.doesNotMatch(output, /\.copy\(|UntrackedOrigin|AnyOrigin|\.clone\(/u);
});

test("associated result aliases close from the exact selected receiver without an object carrier", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, capabilities: [associatedProvider()], files: { "index.ts": associatedSource } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /Family\[Int32\]/u);
  assert.match(output, /\.read\(\)/u);
  assert.doesNotMatch(output, /JsValue|Dict\[|\.copy\(\)/u);
});
