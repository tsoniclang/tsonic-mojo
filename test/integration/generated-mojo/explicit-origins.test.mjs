import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts as artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("explicit source origin parameters are representable without inventing an owned projection", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: { "index.ts": `
import type { Origin, Ref, MutRef, i32 } from "@tsonic/mojo/types.js";
export function identity<O extends Origin>(value: Ref<i32, O>): Ref<i32, O> { return value; }
export function mutableIdentity<O extends Origin>(value: MutRef<i32, O>): MutRef<i32, O> { return value; }
` } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = artifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /O: Origin/u);
  assert.match(emitted, /ref\[/u);
  assert.doesNotMatch(emitted, /\.copy\(\)|UnsafeAnyOrigin|UntrackedOrigin/u);
});
