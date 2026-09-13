import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo, projectArtifactTexts } from "../../helpers/mojo-session.mjs";

const declarations = `
class First { value: number = 1; first: boolean = true; }
class Second { value: number = 2; second: string = "second"; }
class Third { third: boolean = true; }
`;

for (const absent of ["null", "undefined", "null | undefined"]) {
  for (const narrowed of [false, true]) {
    test(`optional project union retains ${absent} with narrowing=${narrowed}`, () => {
      const result = compileMojo({ files: { "index.ts": `${declarations}
export function read(value: First | Second | ${narrowed ? "Third | " : ""}${absent}): number {
  ${narrowed ? "if (value instanceof Third) return 0;" : ""}
  return value?.value ?? 0;
}
export function main(): void {}
` } });
      assert.deepEqual(result.diagnostics, []);
      const source = projectArtifactTexts(result).map(({ text }) => text).join("\n");
      assert.match(source, /if\s+\(?\s*not [^\n]*\.isa\[/u);
      assert.match(source, /unsafe_get\[[^\]]*First\]/u);
      assert.match(source, /unsafe_get\[[^\]]*Second\]/u);
      const parameter = /def read_\(value: ([^\n]+)\) -> Float64:/u.exec(source);
      const snapshot = /var _optional_receiver\w*: ([^\n]+?) = value/u.exec(source);
      assert.ok(parameter, source);
      assert.ok(snapshot, source);
      assert.equal(snapshot[1], parameter[1]);
      if (narrowed) {
        const carrier = snapshot[1];
        const definition = source.slice(source.indexOf(`comptime ${carrier} =`), source.indexOf("def read_("));
        assert.match(carrier.startsWith("Variant[") ? carrier : definition, /\bThird\b/u);
        assert.doesNotMatch(source, /unsafe_get\[Third\]/u);
      }
      for (const marker of absent.split(" | ")) {
        assert.match(source, new RegExp(`not _optional_receiver\\.isa\\[${marker === "null" ? "Null" : "Undefined"}\\]`, "u"));
      }
    });
  }
}

for (const receiver of ["First | null", "First | undefined", "First | null | undefined"]) {
  test(`optional single project receiver: ${receiver}`, () => {
    const result = compileMojo({ files: { "index.ts": `${declarations}
export function read(value: ${receiver}): number { return value?.value ?? 0; }
export function main(): void {}
` } });
    assert.deepEqual(result.diagnostics, []);
  });
}

test("optional union computed keys remain inside the receiver presence region", () => {
  const result = compileMojo({ files: { "index.ts": `${declarations}
function key(): "value" { return "value"; }
export function read(value: First | Second | undefined): number { return value?.[key()] ?? 0; }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const source = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(source, /if not [^\n]+:\n(?:[^\n]*\n)*? +_ = key\(\)/u);
});

for (const wrapped of [false, true]) {
  test(`nested optional project union preserves each presence region: wrapped=${wrapped}`, () => {
    const result = compileMojo({ files: { "index.ts": `${declarations}
class Box { item: First | Second | null = null; }
function key(): "value" { return "value"; }
export function read(box: Box | undefined): number {
  return ${wrapped ? "(box?.item)" : "box?.item"}?.[key()] ?? 0;
}
export function main(): void {}
` } });
    assert.deepEqual(result.diagnostics, []);
    const source = projectArtifactTexts(result).map(({ text }) => text).join("\n");
    assert.match(source, /Optional\[/u);
    assert.match(source, /unsafe_get\[[^\]]*First\]/u);
    assert.match(source, /unsafe_get\[[^\]]*Second\]/u);
    assert.match(source, /and not _optional_receiver\w*\.value\(\)\.isa\[Null\]/u);
  });
}

test("flow-narrowed singleton bindings project their storage rather than a replacement literal", () => {
  const result = compileMojo({ files: { "index.ts": `${declarations}
export function read(value: First | Second | null | undefined): boolean {
  value = undefined;
  return value === undefined;
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const source = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.doesNotMatch(source, /Undefined\(\)\.unsafe_get/u);
  assert.match(source, /value\.unsafe_get\[Undefined\]/u);
});

test("optional chaining does not fabricate a missing project union member", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `${declarations}
export function read(value: First | Third | undefined): number { return value?.value ?? 0; }
export function main(): void {}
` } }), /TS2339/u);
});

test("optional project access cannot become a writable location", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `${declarations}
export function write(value: First | Second | undefined): void { value?.value = 3; }
export function main(): void {}
` } }), /TS2779/u);
});
