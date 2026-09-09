import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { analyzeMojoRuntimeNativePackage } from "../../../dist/analysis/runtime/native-package.js";

const scratch = resolve(".temp/native-dialect-contract");
mkdirSync(scratch, { recursive: true });

function fixture(unit) {
  const root = mkdtempSync(resolve(scratch, "case-"));
  writeFileSync(resolve(root, "native.c"), "int native_value(void) { return 1; }\n");
  writeFileSync(resolve(root, "native.cpp"), 'extern "C" int native_value() { return 1; }\n');
  writeFileSync(resolve(root, "fixture.runtime.json"), JSON.stringify({
    contractVersion: 1, translationUnits: [unit], dynamicLibraries: ["stdc++"],
  }));
  return root;
}

test("native runtime dialects are exact, immutable and fingerprinted", () => {
  const selected = { language: "c++", standard: "c++17", path: "native.cpp" };
  const root = fixture(selected);
  const result = analyzeMojoRuntimeNativePackage(root, "fixture");
  assert.equal(result.translationUnits[0].language, "c++");
  assert.equal(result.translationUnits[0].standard, "c++17");
  assert.ok(Object.isFrozen(result.translationUnits[0]));
  assert.equal(result.digest, analyzeMojoRuntimeNativePackage(root, "fixture").digest);
  writeFileSync(resolve(root, "native.cpp"), 'extern "C" int native_value() { return 2; }\n');
  assert.notEqual(result.digest, analyzeMojoRuntimeNativePackage(root, "fixture").digest);
  const c = analyzeMojoRuntimeNativePackage(fixture({ language: "c", standard: "c11", path: "native.c" }), "fixture");
  assert.equal(c.translationUnits[0].language, "c");
  assert.notEqual(c.digest, result.digest);
});

test("mismatched or unsupported native languages never reach a compiler", () => {
  for (const unit of [
    { language: "c", standard: "c++17", path: "native.c" },
    { language: "c++", standard: "c11", path: "native.cpp" },
    { language: "c++", standard: "c++20", path: "native.cpp" },
    { language: "c++", standard: "c++17", path: "native.c" },
    { language: "c", standard: "c11", path: "native.cpp" },
    { language: "c++", standard: "c++17", path: "../native.cpp" },
  ]) {
    assert.throws(() => analyzeMojoRuntimeNativePackage(fixture(unit), "fixture"), /unsupported translation unit|declared language|invalid translation unit path/u);
  }
});
