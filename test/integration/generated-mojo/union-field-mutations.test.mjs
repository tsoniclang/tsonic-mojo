import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

for (const operation of ["value.value = 7", "value.value += 2", "value.value++", "++value.value", "(value.value) += 2", "(value.value)++"]) {
  test(`closed union field mutation: ${operation}`, () => {
    const result = compileMojo({ files: { "index.ts": `
class First { value: number = 1; first: boolean = true; }
class Second { value: number = 2; second: string = "second"; }
export function change(value: First | Second): number { return ${operation}; }
export function main(): void {}
` } });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
    assert.match(source, /isa\[/u);
    assert.match(source, /unsafe_get\[/u);
  });
}

for (const operation of ["value.value", "value.value = 7", "value.value += 2", "value.value++", "++value.value", "(value.value) += 2", "(value.value)++"]) {
  test(`narrowed union receiver retains its physical carrier: ${operation}`, () => {
    const result = compileMojo({ files: { "index.ts": `
class First { value: number = 1; first: boolean = true; }
class Second { value: number = 2; second: string = "second"; }
class Third { third: boolean = true; }
export function change(value: First | Second | Third): number {
  if (value instanceof Third) return 0;
  return ${operation};
}
export function main(): void {}
` } });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
    const parameter = /def change\(value: ([^\n]+)\) -> Float64:/u.exec(source);
    assert.ok(parameter, source);
    const snapshot = /var _union_property_receiver\w*: ([^\n]+?) = value/u.exec(source);
    assert.ok(snapshot, source);
    assert.equal(snapshot[1], parameter[1]);
    assert.match(snapshot[1], /Third/u);
  });
}

test("a missing union field is not fabricated for a write", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `
class First { value: number = 1; }
class Second { second: string = "second"; }
export function change(value: First | Second): void { value.value = 2; }
export function main(): void {}
` } }), /TS2339/u);
});
