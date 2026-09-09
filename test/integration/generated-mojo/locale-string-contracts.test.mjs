import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generated(source) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).map(({ text }) => text).join("\n");
}

test("locale string calls use exact native receivers and closed data arguments", () => {
  const output = generated(`
    function order(left: string, right: string, locales: string | readonly string[]): number {
      return left.localeCompare(right, locales, { numeric: true, sensitivity: "base" });
    }
    export function main(): void {
      "I".toLocaleLowerCase("tr");
      "i".toLocaleUpperCase(["tr", "en"]);
      "a".localeCompare("b");
      "a".localeCompare("b", undefined, { caseFirst: "upper", ignorePunctuation: true });
      "I".toLocaleLowerCase(undefined);
      order("file2", "file10", "en");
    }
  `);
  assert.match(output, /string_to_locale_lower_case\(/u);
  assert.match(output, /string_to_locale_upper_case\(/u);
  assert.match(output, /string_locale_compare\(/u);
  assert.match(output, /js_value_from_object_entries\(/u);
  assert.doesNotMatch(output, /json_projection|\.toJSON\(/u);
});

test("same-spelled source methods do not select locale runtime operations", () => {
  const output = generated(`
    class Label {
      localeCompare(other: string): number { return 7; }
      toLocaleLowerCase(locale: string): string { return locale; }
    }
    export function main(): void {
      const label = new Label();
      label.localeCompare("other");
      label.toLocaleLowerCase("tr");
    }
  `);
  assert.doesNotMatch(output, /string_locale_compare|string_to_locale_lower_case/u);
});

test("closed locale data conversion does not permit executable option discovery", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
    class Options {
      numeric: boolean = true;
      toJSON(): { numeric: boolean } { return { numeric: true }; }
    }
    export function main(): void { "2".localeCompare("10", "en", new Options()); }
  ` } });
  assert.notEqual(result.diagnostics.length, 0);
  assert.equal(artifactTexts(result).length, 0);
});
