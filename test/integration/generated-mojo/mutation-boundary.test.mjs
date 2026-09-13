import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function compile(operation, surfaces, writeType) {
  return compileMojo({ surfaces, files: { "index.ts": `
class Counter {
  stored: number = 1;
  get value(): number { return this.stored; }
  set value(next: ${writeType}) {}
}
export function change(counter: Counter): number { ${operation} }
export function main(): void {}
` } });
}

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "JS";

  test(`mixed accessor writes and reads remain separately admitted on ${profile}`, () => {
    const result = compile("counter.value = 2; return counter.value;", surfaces, "number | string");
    assert.deepEqual(result.diagnostics, []);
    assert.ok(artifactTexts(result).some(({ text }) => text.includes("def change(")));
  });

  test(`identical accessor compound carriers remain admitted on ${profile}`, () => {
    for (const operation of ["return counter.value += 2;", "return counter.value <<= 2;", "return counter.value++;"]) {
      const result = compile(operation, surfaces, "number");
      assert.deepEqual(result.diagnostics, []);
      assert.ok(result.artifacts.length > 0);
    }
  });

  test(`mixed accessor compounds preserve the numeric result on ${profile}`, () => {
    for (const operation of ["return counter.value = 2;", "return counter.value += 2;", "return counter.value %= 2;", "return counter.value **= 2;", "return counter.value <<= 2;", "return ++counter.value;", "return counter.value++;"]) {
      const result = compile(operation, surfaces, "number | string");
      assert.deepEqual(result.diagnostics, []);
      const source = artifactTexts(result).filter(({ path }) => path.startsWith("src/")).map(({ text }) => text).join("\n");
      assert.match(source, /def change\([^\n]*\) -> Float64:/u);
      assert.match(source, /Variant\[String, Float64\]/u);
    }
  });
}

for (const operation of ["%=", "**="]) {
  test(`arithmetic assignment ${operation} supports local and indexed locations`, () => {
    const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: { "index.ts": `
export function change(seed: number): number {
  let value = seed;
  const first = value ${operation} 2;
  const values = [first];
  const second = values[0] ${operation} 2;
  return value + second;
}
` } });
    assert.deepEqual(result.diagnostics, []);
    assert.ok(result.artifacts.length > 0);
  });
}
