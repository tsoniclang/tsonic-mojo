import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function sourceFor(source) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).map(({ text }) => text).join("\n");
}

test("Date keeps supplied undefined separate from omitted native arguments", () => {
  const source = sourceFor(`
    function update(date: Date, supplied: number | undefined): void {
      date.setUTCSeconds(2);
      date.setUTCSeconds(2, supplied);
      date.setUTCMinutes(3, undefined);
      date.setUTCHours(4, 5, undefined);
      date.setUTCMonth(0, undefined);
      date.setUTCFullYear(2000, undefined, 1);
      Date.UTC(1970);
      Date.UTC(1970, undefined);
      new Date(2000, 0, undefined);
    }
    export function main(): void { update(new Date(1234), undefined); }
  `);
  assert.match(source, /set_utc_seconds\(Float64\(2\)\)/u);
  assert.match(source, /set_utc_seconds\(Float64\(2\), supplied\)/u);
  assert.match(source, /set_utc_minutes\(Float64\(3\), Optional\[Float64\]\(\)\)/u);
  assert.match(source, /date_utc\(Float64\(1970\)\)/u);
  assert.match(source, /date_utc\(Float64\(1970\), Optional\[Float64\]\(\)\)/u);
  assert.doesNotMatch(source, /FloatLiteral\.nan/u);
});

test("Date copies, local operations and nullable JSON use selected source contracts", () => {
  const source = sourceFor(`
    function present(date: Date): string | null { return date.toJSON(); }
    export function main(): void {
      const original = new Date(2024, 2, 10, 2, 30, 0, 0);
      const copy = new Date(original);
      copy.getFullYear(); copy.getMonth(); copy.getDate(); copy.getDay();
      copy.getHours(); copy.getMinutes(); copy.getSeconds(); copy.getMilliseconds();
      copy.getTimezoneOffset(); copy.toDateString(); copy.toTimeString();
      copy.setMilliseconds(5); copy.setSeconds(1, 2); copy.setMinutes(3, 4, 5);
      copy.setHours(6, 7, 8, 9); copy.setDate(10); copy.setMonth(11, 12);
      copy.setFullYear(2025, 0, 1); present(copy);
    }
  `);
  for (const method of [
    "get_full_year", "get_month", "get_date", "get_day", "get_hours",
    "get_minutes", "get_seconds", "get_milliseconds", "get_timezone_offset",
    "set_milliseconds", "set_seconds", "set_minutes", "set_hours",
    "set_date", "set_month", "set_full_year",
  ]) assert.match(source, new RegExp(`\\.${method}\\(`, "u"));
  assert.match(source, /date_new\(original\)/u);
  assert.match(source, /date_to_json_native\(/u);
  assert.match(source, /Variant\[(?:String, Null|Null, String)\]/u);
  assert.match(source, /date_to_date_string_native\(/u);
  assert.match(source, /date_to_time_string_native\(/u);
});

test("same-spelled authored Date methods are not native Date operations", () => {
  const source = sourceFor(`
    class Calendar {
      setUTCSeconds(value: number, other: number | undefined): number { return value; }
      toJSON(): number { return 7; }
    }
    export function main(): void {
      const calendar = new Calendar();
      calendar.setUTCSeconds(1, undefined);
      calendar.toJSON();
    }
  `);
  assert.doesNotMatch(source, /date_to_json_native|\bJsDate\b/u);
  assert.match(source, /def set_utc_seconds\(/u);
  assert.match(source, /calendar\.set_utc_seconds\(/u);
});
