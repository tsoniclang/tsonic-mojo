import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("locale Date methods select ICU-backed operations and closed option data", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
function display(date: Date, locale: string, hour12: boolean): string {
  return date.toLocaleString(locale, { timeZone: "UTC", hour12 });
}
export function main(): void {
  const date = new Date(0);
  date.toLocaleString();
  date.toLocaleDateString("en-US");
  date.toLocaleTimeString(["de-DE", "en-US"], { timeZone: "UTC", hour: "2-digit", minute: "2-digit" });
  date.toLocaleDateString(undefined, { dateStyle: "long" });
  date.toLocaleDateString("en-US", { formatMatcher: "basic", year: "numeric", month: "numeric", day: "numeric" });
  date.toLocaleTimeString("ja-JP", { timeStyle: "short", hourCycle: "h11" });
  date.toLocaleString("ar-EG", { calendar: "gregory", numberingSystem: "latn", fractionalSecondDigits: 3 });
  display(date, "en-GB", false);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  for (const operation of ["date_to_locale_string", "date_to_locale_date_string", "date_to_locale_time_string"]) {
    assert.match(output, new RegExp(`${operation}\\(`, "u"));
  }
  assert.doesNotMatch(output, /date_to_(?:string|date_string|time_string)_native\(/u);
});

test("locale Date source contracts reject incompatible declared option types", () => {
  for (const expression of [
    'date.toLocaleString(42)', 'date.toLocaleString("en-US", { hour12: "true" })',
    'date.toLocaleDateString("en-US", { year: "full" })',
    'date.toLocaleTimeString("en-US", { hourCycle: "h25" })',
    'date.toLocaleTimeString("en-US", { fractionalSecondDigits: 4 })',
    'date.toLocaleDateString("en-US", { formatMatcher: "approximate" })',
  ]) {
    assert.throws(() => compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function main(): void { const date = new Date(0); ${expression}; }
` } }), /TypeScript diagnostics:/u, expression);
  }
});

test("authored same-spelled locale methods do not select Date runtime operations", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class Calendar {
  toLocaleDateString(value: number): number { return value; }
}
export function main(): void { new Calendar().toLocaleDateString(4); }
` } });
  assert.deepEqual(result.diagnostics, []);
  assert.doesNotMatch(artifactTexts(result).map(({ text }) => text).join("\n"), /date_to_locale_date_string/u);
});
