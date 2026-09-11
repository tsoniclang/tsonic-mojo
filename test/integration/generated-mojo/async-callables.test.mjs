import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

export const ownedCallbackSource = `
function retained(seed: number): (step: number) => Promise<number> {
  let total = seed;
  return async (step: number): Promise<number> => { total += step; return total; };
}
export async function run(): Promise<boolean> {
  const next = retained(10);
  const first = await next(2);
  const second = await next(3);
  return first === 12 && second === 15;
}
`;

test("retained asynchronous callbacks own their native coroutine frames", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } },
    files: { "index.ts": ownedCallbackSource } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /ClosedRaisingCoroutine\[Float64\]/u);
  assert.match(emitted, /async def execute/u);
  assert.match(emitted, /Location\[Float64\]/u);
});
