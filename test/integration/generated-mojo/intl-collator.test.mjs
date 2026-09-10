import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

function generated(source) {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": source } });
  assert.deepEqual(result.diagnostics, []);
  return artifactTexts(result).filter(({ path }) => path.endsWith(".mojo")).map(({ text }) => text).join("\n");
}

test("retained Intl collators use exact constructor, method and resolved-property rows", () => {
  const output = generated(`
export function main(): void {
  const options = { numeric: true, sensitivity: "base" as const };
  const collator = new Intl.Collator("de", options);
  const alias = collator;
  options.numeric = false;
  console.log(alias.compare("file2", "file10"));
  const resolved = collator.resolvedOptions();
  const saved = resolved;
  saved.numeric = false;
  saved.locale = "changed";
  console.log(resolved.locale, resolved.usage, resolved.sensitivity, resolved.ignorePunctuation,
    resolved.collation, resolved.numeric, resolved.caseFirst);
  new Intl.Collator();
  new Intl.Collator(["zz", "sv"], undefined);
}
`);
  assert.match(output, /intl_collator_new\(/u);
  assert.match(output, /\.compare\(/u);
  assert.match(output, /\.resolved_options\(/u);
  assert.match(output, /\.set_numeric\(/u);
  assert.match(output, /\.get_locale\(/u);
  assert.doesNotMatch(output, /string_locale_compare\(/u);
});

test("a local same-spelled Collator is not the Intl provider type", () => {
  const output = generated(`
class Collator { compare(left: string, right: string): number { return left.length - right.length; } }
export function main(): void { console.log(new Collator().compare("short", "long")); }
`);
  assert.doesNotMatch(output, /intl_collator_new|IntlResolvedCollatorOptions/u);
});
