import assert from "node:assert/strict";
import test from "node:test";
import { closeMojoSourceModuleEntryPackages } from "../../../dist/analysis/source-modules/entry-packages.js";

function fixture() {
  const sourceFile = {};
  const child = Object.freeze({ sourceFile, componentId: "child", dependencies: Object.freeze([]) });
  const root = Object.freeze({ componentId: "root", root: true, dependencies: Object.freeze(["factory"]) });
  const factory = Object.freeze({ componentId: "factory", root: false, dependencies: Object.freeze(["child"]) });
  const childPackage = Object.freeze({ componentId: "child", root: false, dependencies: Object.freeze([]) });
  const modules = Object.freeze({
    packages: Object.freeze([root, factory, childPackage]),
    definitions: Object.freeze([child]),
    forSourceFile: (file) => file === sourceFile ? child : undefined,
  });
  return { modules, entries: [{ sourceFile, argument: {} }] };
}

test("worker entry artifacts close transitive packages without adding source evaluation edges", () => {
  const input = fixture();
  const result = closeMojoSourceModuleEntryPackages(input.modules, input.entries);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.modules.packages[0].dependencies, ["child", "factory"]);
  assert.deepEqual(input.modules.packages[0].dependencies, ["factory"]);
  assert.equal(result.modules.packages[1], input.modules.packages[1]);
  assert.equal(result.modules.definitions, input.modules.definitions);
  assert.deepEqual(result.modules.definitions[0].dependencies, []);
  assert.ok(Object.isFrozen(result.modules.packages[0].dependencies));
  const repeated = closeMojoSourceModuleEntryPackages(result.modules, [...input.entries, ...input.entries]);
  assert.deepEqual(repeated.modules.packages, result.modules.packages);
});

for (const [name, change] of [
  ["missing component", (modules) => ({ ...modules, packages: modules.packages.slice(0, 2) })],
  ["detached entry", (modules) => ({ ...modules, packages: modules.packages.map((entry) => entry.componentId === "factory" ? { ...entry, dependencies: [] } : entry) })],
  ["missing source", (modules) => ({ ...modules, forSourceFile: () => undefined })],
  ["duplicate root", (modules) => ({ ...modules, packages: modules.packages.map((entry) => ({ ...entry, root: true })) })],
]) {
  test(`worker package closure rejects ${name} without modifying the checked graph`, () => {
    const input = fixture();
    const modules = change(input.modules);
    const result = closeMojoSourceModuleEntryPackages(modules, input.entries);
    assert.ok(result.issues.length > 0);
    assert.equal(result.modules, modules);
    assert.deepEqual(input.modules.packages[0].dependencies, ["factory"]);
  });
}
