import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("Intl dates select retained native instances, closed inputs and aliased parts", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function render(value: Date | number | undefined): string {
  const options = { timeZone: "UTC", month: "long" as const };
  const formatter = new Intl.DateTimeFormat(["zz", "en-US"], options);
  options.timeZone = "-01:00";
  const alias = formatter;
  let output = alias.format(value) + formatter.format(new Date(0)) + formatter.format(0);
  output += formatter.format() + formatter.format(undefined);
  const parts = formatter.formatToParts(value);
  for (const part of parts) output += part.type + part.value;
  const first = parts[0];
  first.value = "changed";
  first.type = "literal";
  const resolved = formatter.resolvedOptions();
  const saved = resolved;
  saved.timeZone = "changed";
  output += resolved.locale + resolved.calendar + resolved.numberingSystem + resolved.timeZone;
  formatter.formatToParts();
  return output;
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).filter(({ path }) => path.endsWith(".mojo")).map(({ text }) => text).join("\n");
  for (const operation of ["intl_datetime_format_new", ".format(", ".format_to_parts(", ".resolved_options(", ".get_type(", ".get_time_zone(", ".set_value("])
    assert.ok(output.includes(operation), operation);
  assert.doesNotMatch(output, /date_to_locale_string\(/u);
});

test("a user-defined DateTimeFormat never selects Intl operations", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class DateTimeFormat { format(value: number): string { return value.toString(); } }
export function render(): string { return new DateTimeFormat().format(7); }
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.doesNotMatch(output, /intl_datetime_format_new|IntlResolvedDateTimeFormatOptions/u);
});
