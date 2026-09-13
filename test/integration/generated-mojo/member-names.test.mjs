import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const fixtures = [
  ["interface literal keys", `interface Header { "content-type": string; 0: number; }
export function read(value: Header): string { return value["content-type"]; }
export function size(value: Header): number { return value[0]; }
export function create(): Header { return { "content-type": "text/plain", 0: 7 }; }`],
  ["class literal keys and sanitized-name collisions", `class Header {
  "x-value": number = 3; x_value: number = 5;
  static "header-count": number = 2;
}
export function read(): number {
  const value = new Header(); value["x-value"] += 1;
  return value["x-value"] + value.x_value + Header["header-count"];
}`],
  ["literal accessor names", `class Header {
  stored: number = 1;
  get "x-value"(): number { return this.stored; }
  set "x-value"(value: number) { this.stored = value; }
}
export function read(): number { const value = new Header(); return value["x-value"]++; }`],
  ["literal method names", `class Reader { "read-value"(): number { return 7; } }
export function read(): number { return new Reader()["read-value"](); }`],
  ["quoted enum names", `enum Mode { "read-only" = 3, "read-write" = 5 }
export function read(value: Mode): boolean { return value === Mode["read-only"]; }`],
  ["selected computed key evaluation", `class Header { value: number = 1; trace: string = ""; }
function key(value: Header): "value" { value.trace += "k"; return "value"; }
function receiver(value: Header): Header { value.trace += "r"; return value; }
export function read(): number { const value = new Header(); return receiver(value)[key(value)]++; }`],
  ["selected computed method key evaluation", `class Reader { trace: string = ""; "read-value"(): number { return 7; } }
function key(value: Reader): "read-value" { value.trace += "k"; return "read-value"; }
export function read(value: Reader): number { return value[key(value)](); }`],
];

for (const [name, source] of fixtures) {
  test(`exact declared member names: ${name}`, () => {
    const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: { "index.ts": source } });
    assert.deepEqual(result.diagnostics, []);
    const text = artifactTexts(result).filter(({ path }) => path.startsWith("src/")).map(({ text }) => text).join("\n");
    assert.match(text, /def read_\(/u);
    assert.doesNotMatch(text, /getattr|setattr|__dict__/u);
  });
}

test("literal member selection never resolves an unrelated same-spelled declaration", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `
class Left { "x-value": number = 1; }
class Right { "x-value": string = "right"; }
export function read(value: Right): number { return value["x-value"]; }
` } }), /TS2322: Type 'string' is not assignable to type 'number'/u);
});

test("indexed accessor updates retain the source compiler's write-side numeric requirement", () => {
  assert.throws(() => compileMojo({ files: { "index.ts": `
class Header {
  get value(): number { return 1; }
  set value(next: number | string) {}
}
export function read(value: Header): number { return value["value"]++; }
` } }), /TS2356: An arithmetic operand/u);
});
