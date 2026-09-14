import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

for (const surfaces of [[], ["js"]]) {
  for (const [name, body] of [
    ["large literal arithmetic", "return (value + 1234567890123456789012345678901234567890n) * 2n;"],
    ["immutable local and updates", "let result = value; result++; ++result; result -= 1n; return result;"],
    ["division and remainder", "return (value / 7n) % -3n;"],
    ["power and shifts", "return (value ** 2n) << -1n;"],
    ["integer bitwise operations", "return (~value & 31n) | (value ^ 7n);"],
  ]) {
    test(`source bigint ${name} (${surfaces.length === 0 ? "native" : "JS"})`, () => {
      const result = compileMojo({ surfaces, files: { "index.ts": `
export function compute(value: bigint): bigint { ${body} }
export function main(): void {}
` } });
      assert.deepEqual(result.diagnostics, []);
      const text = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
      assert.match(text, /BigInt/u);
      assert.doesNotMatch(text, /Int128\(|Float64\(/u);
      if (name === "large literal arithmetic") {
        assert.match(text, /from_decimal_literal\(\s*"1234567890123456789012345678901234567890",?\s*\)/u);
      }
    });
  }
}

test("arbitrary bigint boxes into closed JS data without number conversion", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function box(value: bigint): unknown { return value; }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.ok(artifactTexts(result).some((item) => item.text.includes("js_value_from_bigint")));
});

test("bigint literals retain binary, octal, hexadecimal and separator precision", () => {
  const literals = ["0xFFFF_FFFF_FFFF_FFFF_FFFF_FFFFn", "0o7777777777777777777777777n", "0b1111_0000n"];
  const result = compileMojo({ files: { "index.ts": `
export function sum(): bigint { return ${literals.join(" + ")}; }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
  for (const literal of literals) {
    assert.ok(text.includes(`"${BigInt(literal.slice(0, -1).replace(/_/gu, "")).toString()}"`));
  }
});

test("bigint conversion to an authored native integer uses a checked boundary", () => {
  const result = compileMojo({ files: { "index.ts": `
import type { int64 } from "@tsonic/core/types.js";
export function narrow(value: bigint): int64 { return value as int64; }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
  assert.match(text, /bigint_to_integer\[Int64\]\(value\)/u);
  assert.match(text, /def narrow\(value: BigInt\) raises/u);
});

test("proved native-width bigint literals materialize without heap allocation or error effects", () => {
  const result = compileMojo({ files: { "index.ts": `
import type { int64, uint64, int128, uint128 } from "@tsonic/core/types.js";
export function literals(): [int64, uint64, int128, uint128] {
  return [(-9223372036854775808n), 0xffff_ffff_ffff_ffffn,
    -170141183460469231731687303715884105728n, 340282366920938463463374607431768211455n];
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
  for (const literal of ["Int64(-9223372036854775808)",
    "UInt64(18446744073709551615)", "Int128(-170141183460469231731687303715884105728)",
    "UInt128(340282366920938463463374607431768211455)"]) assert.ok(text.includes(literal), literal);
  assert.doesNotMatch(text, /from_decimal_literal|bigint_to_integer|def literals\([^\n]*\) raises/u);
});

test("out-of-range bigint literals keep a checked native conversion", () => {
  const result = compileMojo({ files: { "index.ts": `
import type { int64, uint64 } from "@tsonic/core/types.js";
export function signed(): int64 { return 9223372036854775808n as int64; }
export function unsigned(): uint64 { return -1n as uint64; }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const text = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
  assert.match(text, /bigint_to_integer\[Int64\]/u);
  assert.match(text, /bigint_to_integer\[UInt64\]/u);
});
