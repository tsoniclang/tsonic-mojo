import assert from "node:assert/strict";
import test from "node:test";
import { projectArtifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";
import { defaultArgumentsFactorySource, emptyFactorySource, ownedCallbackSource, throwingFactorySource } from "../../helpers/async-callables.mjs";

test("retained asynchronous callbacks own their native coroutine frames", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } },
    files: { "index.ts": ownedCallbackSource } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /ClosedRaisingCoroutine\[Float64\]/u);
  assert.match(emitted, /async def execute/u);
  assert.match(emitted, /Location\[Float64\]/u);
  assert.match(emitted, /make_async_callable/u);
  assert.match(emitted, /take_async_invocation/u);
  assert.match(emitted, /finally:\s+_ = .*invocation_owner/u);
  assert.doesNotMatch(emitted, /unsafe_origin_cast/u);
});

test("async callable bodies keep argument defaults and rest packing inside execution", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: {
    "index.ts": `${defaultArgumentsFactorySource}
export async function consume(): Promise<string> {
  const callback = create("prefix:");
  return await callback(undefined, "first", "second");
}`,
  } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /ClosedRaisingCoroutine\[String\]/u);
  assert.match(emitted, /take_async_invocation\[\s*Tuple\[Optional\[String\], List\[String\]\],?\s*\]/u);
  assert.match(emitted, /var _callable_rest_values[^:]*: List\[String\] = \["first", "second"\]/u);
  assert.match(emitted, /_callable_value\.call\(\(_call_argument, _callable_rest_values\^\)\)/u);
  assert.match(emitted, /finally:\s+_ = .*invocation_owner/u);
});

test("unsupported native async error payloads cannot publish silently lossy artifacts", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } },
    files: { "index.ts": throwingFactorySource } });
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_NATIVE_COROUTINE_ERROR_DOMAIN_UNSUPPORTED"));
  assert.deepEqual(result.artifacts, []);
});

test("zero-argument async factories retain their empty invocation tuple", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: {
    "index.ts": emptyFactorySource,
  } });
  assert.deepEqual(result.diagnostics, []);
  assert.match(projectArtifactTexts(result).map(({ text }) => text).join("\n"), /make_async_callable\[Tuple\[\], Float64\]/u);
});

test("native error-domain validation uses escaping effects rather than a throw-syntax ban", () => {
  for (const source of [
    "export async function value(): Promise<number> { try { throw new Error('local'); } catch { return 1; } }",
    "export function value(): () => Promise<number> { return async () => { try { throw new Error('local'); } catch { return 1; } }; }",
    "export function value(): number { throw new Error('synchronous'); }",
  ]) {
    const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: { "index.ts": source } });
    assert.deepEqual(result.diagnostics, []);
  }
});

test("nested awaits in retained callbacks remain native coroutine operations", () => {
  const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, files: {
    "index.ts": `
async function value(step: number): Promise<number> { return step + 1; }
export function create(seed: number): (step: number) => Promise<number> {
  let total = seed;
  return async (step: number): Promise<number> => { total += await value(step); return total; };
}`,
  } });
  assert.deepEqual(result.diagnostics, []);
  const emitted = projectArtifactTexts(result).map(({ text }) => text).join("\n");
  assert.match(emitted, /async def execute/u);
  assert.match(emitted, /await create_task/u);
  assert.doesNotMatch(emitted, /\.wait\(|unsafe_origin_cast/u);
});

test("retained async callbacks do not silently substitute a native scheduler for JS promises", () => {
  const result = compileMojo({ surfaces: ["js"], files: { "index.ts": `
export function create(): () => Promise<number> { return async () => 1; }
` } });
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_ASYNC_CALLABLE_SCHEDULER_NOT_SUPPORTED"));
  assert.deepEqual(result.artifacts, []);
});
