import assert from "node:assert/strict";
import test from "node:test";
import { mojoProviderCompoundWriteIssue } from "../../../dist/policy/operations/mutation-admission.js";

const number = Object.freeze({ kind: "source-primitive", name: "float64" });
const integer = Object.freeze({ kind: "source-primitive", name: "int32" });

test("provider compound admission preserves separate reads and converted simple writes", () => {
  for (const accessMode of ["read", "write", "delete"]) {
    assert.equal(mojoProviderCompoundWriteIssue(accessMode, number, integer), undefined);
  }
  assert.equal(mojoProviderCompoundWriteIssue("read-write", number, { ...number }), undefined);
});

test("provider compound admission compares exact carriers rather than printed names", () => {
  const source = Object.freeze({
    kind: "target-named", id: "fixture.source.Counter", modulePath: ["source"], name: "Counter",
  });
  const target = Object.freeze({ ...source, id: "fixture.native.Counter" });
  for (const [sourceType, targetType] of [[number, integer], [integer, number], [source, target]]) {
    const issue = mojoProviderCompoundWriteIssue("read-write", sourceType, targetType);
    assert.equal(issue?.kind, "unsupported");
    assert.equal(issue?.code, "MOJO_PROVIDER_COMPOUND_WRITE_CONVERSION_UNSUPPORTED");
    assert.equal(Object.isFrozen(issue), true);
  }
});
