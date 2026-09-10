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

  test(`mixed accessor compounds reject during analysis on ${profile}`, () => {
    for (const operation of ["return counter.value += 2;", "return counter.value <<= 2;", "return ++counter.value;"]) {
      const result = compile(operation, surfaces, "number | string");
      assert.deepEqual(result.artifacts, []);
      const issue = result.diagnostics.find(({ code }) => code === "MOJO_PROJECT_ACCESSOR_COMPOUND_WRITE_UNSUPPORTED");
      assert.ok(issue, JSON.stringify(result.diagnostics));
      assert.deepEqual(issue.evidence, ["target.capability=mojo.backend.foundation"]);
    }
  });
}
