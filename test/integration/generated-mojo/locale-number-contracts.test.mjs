import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("Number locale presentation retains exact selected receiver and closed options", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
function display(amount: number, locale: string): string {
  return amount.toLocaleString(locale, { style: "currency", currency: "EUR" });
}
export function main(): void {
  const amount = 1234.5;
  amount.toLocaleString();
  amount.toLocaleString("en-US");
  amount.toLocaleString(["de-DE", "en-US"], { useGrouping: false, minimumFractionDigits: 2 });
  amount.toLocaleString(undefined, { roundingIncrement: 5, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  amount.toLocaleString("en-US", { notation: "compact", compactDisplay: "long", signDisplay: "always" });
  amount.toLocaleString("en-US", { minimumSignificantDigits: 2, roundingPriority: "morePrecision", roundingMode: "halfEven" });
  amount.toLocaleString("en-US", { numberingSystem: "arab", trailingZeroDisplay: "stripIfInteger" });
  display(amount, "de-DE");
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /number_to_locale_string\(/u);
  assert.doesNotMatch(output, /number_to_(?:fixed|precision|exponential)\(/u);
});

test("Number locale declarations reject incompatible option contracts", () => {
  for (const expression of [
    "amount.toLocaleString(42)", 'amount.toLocaleString("en-US", { useGrouping: "false" })',
    'amount.toLocaleString("en-US", { style: "unit" })',
    'amount.toLocaleString("en-US", { minimumFractionDigits: "2" })',
    'amount.toLocaleString("en-US", { roundingMode: "nearest" })',
    'amount.toLocaleString("en-US", { notation: "exponential" })',
  ]) {
    assert.throws(() => compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function main(): void { const amount = 12.5; ${expression}; }
` } }), /TypeScript diagnostics:/u, expression);
  }
});

test("integral locale calls keep their exact native width instead of converting to Float64", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
import type { i64, u64 } from "@tsonic/mojo/types.js";
function signed(value: i64): string { return value.toLocaleString("en-US"); }
function unsigned(value: u64): string { return value.toLocaleString("en-US"); }
export function main(): void { signed(-1n); unsigned(2n); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(output, /number_to_locale_string\(value,/u);
  assert.doesNotMatch(output, /number_to_locale_string\(Float64\(/u);
});

test("authored same-spelled locale member does not select the numeric intrinsic", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class Amount { toLocaleString(value: number): number { return value; } }
export function main(): void { new Amount().toLocaleString(4); }
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactTexts(result).map(({ text }) => text).join("\n"), /number_to_locale_string/u);
});
