import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveMojoProjectConfiguration } from "../../../dist/options/mojo-user-project.js";

const fixture = fileURLToPath(new URL("../../fixtures/user-project/pixi.toml", import.meta.url));

test("user-owned Mojo projects require an existing external pixi.toml", () => {
  const project = resolveMojoProjectConfiguration(
    "pixi.toml",
    dirname(fixture),
    join(dirname(fixture), "generated"),
  );
  assert.deepEqual(project, { kind: "user-owned", manifestPath: fixture });
});

test("user-owned Mojo projects reject non-Pixi and generated-output manifests", () => {
  assert.throws(
    () => resolveMojoProjectConfiguration("package.json", dirname(fixture), "/outside"),
    /must point to pixi\.toml/u,
  );
  assert.throws(
    () => resolveMojoProjectConfiguration("pixi.toml", dirname(fixture), dirname(fixture)),
    /must not point inside generated target output root/u,
  );
});
