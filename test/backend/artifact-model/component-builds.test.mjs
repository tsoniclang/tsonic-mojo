import assert from "node:assert/strict";
import test from "node:test";
import { createMojoComponentBuilds } from "../../../dist/backend/artifact-model/project/component-builds.js";

function plan(dependencyIds = ["dependency"]) {
  return {
    configuration: { outputType: "bin" }, runtimePackages: [{}],
    components: [
      { id: "root", packageName: "main", root: true, dependencies: dependencyIds, artifactKey: "a".repeat(64) },
      { id: "dependency", packageName: "library", root: false, dependencies: [], artifactKey: "b".repeat(64) },
    ],
  };
}

test("component build descriptors include dependency artifacts, never dependency source directories", () => {
  const builds = createMojoComponentBuilds(plan());
  assert.deepEqual(builds.map(({ id }) => id), ["dependency", "root"]);
  assert.equal(builds[0].sourcePath, "components/library/src/library");
  assert.equal(builds[0].artifactPath, `build/components/${"b".repeat(64)}/library.mojoc`);
  assert.deepEqual(builds[1].includeDirectories, ["src", `build/components/${"b".repeat(64)}`, "packages"]);
  assert.equal(builds[1].sourcePath, "src/main.mojo");
  assert.equal(builds[1].artifactPath, "build/main");
});

test("component publication rejects missing, cyclic, detached, and duplicate-root graphs", () => {
  assert.throws(() => createMojoComponentBuilds(plan(["absent"])), /missing/u);
  assert.throws(() => createMojoComponentBuilds(plan([])), /unreachable/u);
  const cyclic = plan();
  cyclic.components[1].dependencies = ["root"];
  assert.throws(() => createMojoComponentBuilds(cyclic), /cycle/u);
  const duplicate = plan();
  duplicate.components[1].root = true;
  assert.throws(() => createMojoComponentBuilds(duplicate), /exactly one root/u);
});
