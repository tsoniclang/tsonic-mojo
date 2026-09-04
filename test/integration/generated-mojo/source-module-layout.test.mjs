import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo } from "../../helpers/mojo-session.mjs";

test("file facades and same-named index modules retain distinct native identities", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import { value } from "./feature.js";',
        "export function main(): void { value(); }",
      ].join("\n"),
      "feature.ts": 'export { value } from "./feature/index.js";',
      "feature/index.ts": 'export { value } from "./index/index.js";',
      "feature/index/index.ts": "export function value(): void {}",
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sourcePaths = result.artifacts
    .filter(({ kind, language }) => kind === "source" && language === "mojo")
    .map(({ path }) => path);
  assert.ok(sourcePaths.includes("src/tsonic_generated/feature/__init__.mojo"));
  assert.ok(sourcePaths.includes("src/tsonic_generated/feature/index/__init__.mojo"));
  assert.ok(sourcePaths.includes("src/tsonic_generated/feature/index/index.mojo"));
  assert.equal(new Set(sourcePaths).size, sourcePaths.length);
});
