import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo } from "../../helpers/mojo-session.mjs";

test("unsupported JS scheduler awaits are rejected by analysis before syntax planning", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export async function consume(task: Promise<number>): Promise<number> {
  return await task;
}` } });
  const issue = result.diagnostics.find((diagnostic) => diagnostic.code === "MOJO_JS_PROMISE_AWAIT_RUNTIME_MISSING");
  assert.ok(issue, JSON.stringify(result.diagnostics));
  assert.deepEqual(issue.evidence, ["target.capability=mojo.analysis.await"]);
  assert.deepEqual(result.artifacts, []);
});
