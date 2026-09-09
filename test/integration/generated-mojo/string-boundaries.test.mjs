import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generated(source) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).filter(({ path }) => path.startsWith("src/") && path.endsWith(".mojo"))
    .map(({ text }) => text).join("\n");
}

test("native string operations seal their lossless conversion errors before planning", () => {
  const output = generated(`
    export function selected(value: string): string { return value.charAt(0); }
    export function indexed(value: string, index: number): string { return value[index]!; }
    export function sliced(value: string): string { return value.slice(0, 1); }
    export function padded(value: string): string { return value.padStart(2, "😀"); }
    export function codes(): string { return String.fromCharCode(0xD800); }
    export function point(value: string): number | undefined { return value.codePointAt(0); }
    export function caught(value: string): boolean {
      try { value.charAt(0); return true; } catch { return false; }
    }
    export function main(): void { selected("a"); }
  `);
  for (const name of ["selected", "indexed", "sliced", "padded", "codes"]) {
    assert.match(output, new RegExp(`def ${name}\\([^\\n]*\\) raises Error -> String`, "u"));
  }
  assert.match(output, /def point\(value: String\) -> Optional\[Float64\]/u);
  assert.match(output, /def caught\(value: String\) -> Bool/u);
  assert.match(output, /native_string_char_at/u);
  assert.doesNotMatch(output, /to_native_lossy/u);
});

test("conversion effects cover constructors, bindings and returns but stop at caught regions", () => {
  const output = generated(`
    import type { int32 } from "@tsonic/core/types.js";
    class Values {
      items: int32[];
      constructor() { this.items = [0]; }
    }
    export function returned(): int32[] { return [0]; }
    export function local(): int32[] { const items: int32[] = [0]; return items; }
    export function nested(): int32[] { const get = (): int32[] => [0]; return get(); }
    export function caught(): boolean {
      try { const items: int32[] = [0]; return items.length === 1; } catch { return false; }
    }
    export function plain(): number { return 1; }
    export function main(): void { new Values(); returned(); local(); nested(); caught(); plain(); }
  `);
  assert.match(output, /def __init__\(out self\) raises Error:/u);
  for (const name of ["returned", "local", "nested"]) {
    assert.match(output, new RegExp(`def ${name}\\(\\) raises Error`, "u"));
  }
  assert.match(output, /def caught\(\) -> Bool/u);
  assert.match(output, /def plain\(\) -> Float64/u);
});
