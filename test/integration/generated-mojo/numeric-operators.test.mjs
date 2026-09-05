import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const binaryOperations = [
  ["&", "bitwise_and"], ["|", "bitwise_or"], ["^", "bitwise_xor"],
  ["<<", "shift_left"], [">>", "shift_right"], [">>>", "unsigned_shift_right"],
];

function compile(source, surfaces = []) {
  const result = compileMojo({ surfaces, files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).map(({ text }) => text).join("\n");
}

for (const surfaces of [[], ["js"]]) {
  test(`source number bitwise operations use exact runtime semantics on ${surfaces.length === 0 ? "native" : "JS"} profile`, () => {
    const generated = compile([
      "export function complement(value: number): number { return ~value; }",
      ...binaryOperations.map(([operator], index) =>
        `export function binary${index}(left: number, right: number): number { return left ${operator} right; }`),
    ].join("\n"), surfaces);
    for (const suffix of ["bitwise_not", ...binaryOperations.map(([, suffix]) => suffix)]) {
      assert.match(generated, new RegExp(`source_number_${suffix}\\(`, "u"));
    }
    assert.doesNotMatch(generated, /left (?:<<|>>|&|\||\^) right/u);
  });

  test(`every number compound operator shares the selected numeric operation on ${surfaces.length === 0 ? "native" : "JS"} profile`, () => {
    const generated = compile(binaryOperations.map(([operator], index) =>
      `export function compound${index}(value: number, amount: number): number { return value ${operator}= amount; }`,
    ).join("\n"), surfaces);
    for (const [, suffix] of binaryOperations) assert.match(generated, new RegExp(`source_number_${suffix}\\(`, "u"));
    assert.doesNotMatch(generated, /(?:<<|>>|>>>|&|\||\^)=/u);
  });
}

test("explicit integral bitwise operations retain native carriers", () => {
  const generated = compile([
    'import type { int32 } from "@tsonic/core/types.js";',
    "export function bitwise(left: int32, right: int32): int32 { return (left & right) | (left ^ right); }",
    "export function shift(value: int32): int32 { return (value << 8) >> 2; }",
    "export function complement(value: int32): int32 { return ~value; }",
    "export function unsigned(value: int32, count: int32): int32 { return value >>> count; }",
  ].join("\n"));
  assert.doesNotMatch(generated, /source_number_|Float64/u);
  assert.match(generated, /UInt32/u);
  assert.match(generated, /<</u);
});

test("mixed source number and int32 operands retain source-number semantics", () => {
  const generated = compile([
    'import type { int32 } from "@tsonic/core/types.js";',
    "export function shift(value: number, amount: int32): int32 { return value << amount; }",
    "export function compound(value: int32, amount: number): int32 { return value <<= amount; }",
  ].join("\n"));
  assert.match(generated, /source_number_shift_left/u);
  assert.doesNotMatch(generated, /<< Float64/u);
});

test("numeric compound accessors retain getter-before-RHS-before-setter ordering", () => {
  const generated = compile(`
class Cell {
  stored: number = 7;
  get value(): number { return this.stored; }
  set value(value: number) { this.stored = value; }
}
function next(cell: Cell): number { cell.stored = 99; return 2; }
export function compound(cell: Cell): number { return cell.value <<= next(cell); }
`);
  assert.match(generated, /source_number_shift_left/u);
  assert.match(generated, /property_write_current/u);
  assert.match(generated, /property_write_value/u);
});

test("bitwise numeric operands are not accepted through an open carrier", () => {
  const result = compileMojo({ files: { "index.ts": "export function invalid(value: unknown): number { return value << 1; }" } });
  assert.notEqual(result.diagnostics.length, 0);
});
