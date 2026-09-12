import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("Intl numbers retain exact input widths and selected part identities", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
import type { int64, uint64 } from "@tsonic/core/types.js";
export function render(signed: int64, unsigned: uint64): string {
  const options = { useGrouping: false, minimumFractionDigits: 2 };
  const formatter = new Intl.NumberFormat("en-US", options);
  options.minimumFractionDigits = 4;
  const alias = formatter;
  let output = alias.format(signed) + formatter.format(unsigned) + formatter.format(-0);
  const parts = formatter.formatToParts(1234.5);
  for (const part of parts) output += part.type + part.value;
  const first = parts[0];
  first.type = "literal";
  first.value = "changed";
  return output;
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).filter(({ path }) => path.endsWith(".mojo")).map(({ text }) => text).join("\n");
  for (const operation of ["intl_number_format_new(", ".format(", ".format_to_parts(", ".get_type(", ".set_value("])
    assert.ok(output.includes(operation), operation);
  assert.doesNotMatch(output, /Float64\(signed\)|Float64\(unsigned\)/u);
});

test("a local NumberFormat declaration is independent of Intl", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class NumberFormat { format(value: number): string { return value.toString(); } }
export function render(): string { return new NumberFormat().format(9); }
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactTexts(result).map(({ text }) => text).join("\n"), /intl_number_format_new/u);
});

test("Intl unit options survive variable snapshots and exact selected formatter operations", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
import type { uint64 } from "@tsonic/core/types.js";
export function render(value: uint64): string {
  const options = { style: "unit" as const, unit: "meter", unitDisplay: "long" as const };
  const formatter = new Intl.NumberFormat("en-US", options);
  options.unit = "liter";
  const resolved = formatter.resolvedOptions();
  let text = formatter.format(value);
  if (resolved.unit !== undefined) text += resolved.unit;
  if (resolved.unitDisplay !== undefined) text += resolved.unitDisplay;
  for (const part of formatter.formatToParts(value)) text += part.type + part.value;
  return text + (3).toLocaleString("en-US", options);
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  for (const operation of ["intl_number_format_new(", ".get_unit(", ".get_unit_display(", ".format_to_parts(", "number_to_locale_string("])
    assert.ok(output.includes(operation), operation);
  assert.doesNotMatch(output, /Float64\(value\)/u);
});

test("NumberFormat resolved options preserve optional fields and grouping strategies", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function render(): string {
  const formatter = new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 3, useGrouping: "min2", roundingMode: "halfEven",
  });
  const resolved = formatter.resolvedOptions();
  let result = resolved.locale + resolved.numberingSystem + resolved.style;
  result += resolved.notation + resolved.signDisplay + resolved.roundingPriority;
  result += resolved.roundingMode + resolved.trailingZeroDisplay;
  if (resolved.useGrouping !== false) result += resolved.useGrouping;
  if (resolved.maximumSignificantDigits !== undefined) result += resolved.maximumSignificantDigits.toString();
  if (resolved.minimumFractionDigits !== undefined) result += resolved.minimumFractionDigits.toString();
  resolved.useGrouping = false;
  resolved.unit = "meter";
  resolved.unitDisplay = "long";
  resolved.maximumFractionDigits = undefined;
  return result + formatter.format(1234);
}
export function main(): void {}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  for (const operation of [".resolved_options(", ".get_use_grouping(", ".get_maximum_significant_digits(", ".set_unit(", ".set_unit_display(", ".set_maximum_fraction_digits("])
    assert.ok(output.includes(operation), operation);
});
