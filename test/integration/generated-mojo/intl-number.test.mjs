import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

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
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactTexts(result).map(({ text }) => text).join("\n"), /intl_number_format_new/u);
});
