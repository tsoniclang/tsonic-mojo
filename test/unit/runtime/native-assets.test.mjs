import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeMojoRuntimeNativePackage } from "../../../dist/analysis/runtime/native-package.js";
import { createMojoNativeBuildPlan } from "../../../dist/backend/artifact-model/project/native.js";

const scratch = resolve(".temp/native-assets-contract");
mkdirSync(scratch, { recursive: true });

function fixture(change = {}) {
  const root = mkdtempSync(resolve(scratch, "case-"));
  mkdirSync(resolve(root, "include"));
  writeFileSync(resolve(root, "include/value.h"), "\ufeff#define VALUE 42\r\n");
  writeFileSync(resolve(root, "native.c"), '#include "value.h"\nint native_value(void) { return VALUE; }\n');
  writeFileSync(resolve(root, "fixture.runtime.json"), JSON.stringify({
    contractVersion: 1,
    translationUnits: [{ language: "c", standard: "c11", path: "native.c" }],
    assets: ["include/value.h"],
    sourceIncludeDirectories: ["include"], includeDirectories: ["include/external"],
    ...change,
  }));
  return root;
}

test("native assets are immutable byte-exact captures with separate include domains", () => {
  const root = fixture();
  const native = analyzeMojoRuntimeNativePackage(root, "fixture");
  assert.ok(Object.isFrozen(native.assets));
  assert.ok(Object.isFrozen(native.assets[0]));
  assert.deepEqual(Buffer.from(native.assets[0].text, "utf8"), readFileSync(resolve(root, "include/value.h")));
  assert.deepEqual(native.sourceIncludeDirectories, ["include"]);
  assert.deepEqual(native.includeDirectories, ["include/external"]);
  const plan = createMojoNativeBuildPlan([{ packageName: "fixture", native }]);
  assert.deepEqual(plan.packages[0].sourceIncludeDirectories, ["packages/.native/fixture/include"]);
  assert.deepEqual(plan.packages[0].includeDirectories, ["include/external"]);
});

test("header edits invalidate package and native object identities without changing source", () => {
  const root = fixture();
  const before = analyzeMojoRuntimeNativePackage(root, "fixture");
  assert.deepEqual(before, analyzeMojoRuntimeNativePackage(root, "fixture"));
  writeFileSync(resolve(root, "include/value.h"), "#define VALUE 43\n");
  const after = analyzeMojoRuntimeNativePackage(root, "fixture");
  assert.equal(before.translationUnits[0].text, after.translationUnits[0].text);
  assert.notEqual(before.digest, after.digest);
  assert.notEqual(before.translationUnits[0].digest, after.translationUnits[0].digest);
  assert.notEqual(before.assets[0].digest, after.assets[0].digest);
});

test("native paths cannot escape, alias an entry, or reference an unpublished include directory", () => {
  for (const change of [
    { assets: ["../outside.h"] }, { assets: ["/outside.h"] },
    { assets: ["include/../native.c"] }, { assets: ["include/value.h", "include/value.h"] },
    { assets: ["native.c"] }, { assets: ["include/missing.h"] },
    { assets: [], sourceIncludeDirectories: ["include"] },
    { sourceIncludeDirectories: ["../include"] },
  ]) {
    assert.throws(() => analyzeMojoRuntimeNativePackage(fixture(change), "fixture"),
      /invalid.*path|duplicated|ENOENT|no published files/u);
  }
  const root = fixture({ assets: ["linked/value.h"], sourceIncludeDirectories: [] });
  symlinkSync(resolve(root, "include"), resolve(root, "linked"), "dir");
  assert.throws(() => analyzeMojoRuntimeNativePackage(root, "fixture"), /no symlinks/u);
});

test("native asset size and UTF-8 validity are checked before publication", () => {
  const root = fixture();
  writeFileSync(resolve(root, "include/value.h"), Buffer.from([0xff]));
  assert.throws(() => analyzeMojoRuntimeNativePackage(root, "fixture"), /encoded data/u);
  truncateSync(resolve(root, "include/value.h"), 67_108_865);
  assert.throws(() => analyzeMojoRuntimeNativePackage(root, "fixture"), /byte budget/u);
});
