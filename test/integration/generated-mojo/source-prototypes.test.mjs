import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("closed source views retain source prototypes rather than specialized native type names", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
class Box<T> { value: T; constructor(value: T) { this.value = value; } }
class OtherBox<T> { value: T; constructor(value: T) { this.value = value; } }
export function main(): void {
  const first: unknown = new Box(1);
  const second: unknown = new Box("one");
  const other: unknown = new OtherBox(1);
  const literal: unknown = { value: 1 };
  console.log(first, second, other, literal);
}
` } });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactTexts(result).map(({ text }) => text).join("\n");
  const identities = [...output.matchAll(/prototype_identity=\(?\s*"([^"]*)"/gu)].map((match) => match[1]);
  assert.equal(identities.filter((identity) => identity === "").length, 1);
  const declared = identities.filter(Boolean);
  assert.equal(declared.length, 3);
  assert.deepEqual([...new Set(declared)].map((identity) => declared.filter((candidate) => candidate === identity).length).sort(), [1, 2]);
});
