import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMojoStatements,
} from "../../../dist/backend/normalization/index.js";

test("normalization joins an adjacent uninitialized declaration and assignment", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  assert.deepEqual(normalizeMojoStatements([
    { kind: "variable", name: "value", type: int32 },
    {
      kind: "assignment",
      operator: "=",
      left: { kind: "path", path: "value" },
      right: { kind: "number-literal", text: "3" },
    },
    { kind: "return", expression: { kind: "path", path: "value" } },
  ]), [
    {
      kind: "variable",
      name: "value",
      type: int32,
      initializer: { kind: "number-literal", text: "3" },
    },
    { kind: "return", expression: { kind: "path", path: "value" } },
  ]);
});

test("normalization removes only proven inert discarded literals", () => {
  const call = {
    kind: "call",
    callee: { kind: "path", path: "perform_work" },
    arguments: [],
  };
  assert.deepEqual(normalizeMojoStatements([
    { kind: "discard", expression: { kind: "number-literal", text: "1" } },
    { kind: "discard", expression: { kind: "bool-literal", value: true } },
    { kind: "discard", expression: call },
  ]), [{ kind: "discard", expression: call }]);
});

test("normalization removes statements after a terminating branch", () => {
  assert.deepEqual(normalizeMojoStatements([
    { kind: "return", expression: { kind: "number-literal", text: "1" } },
    { kind: "discard", expression: { kind: "number-literal", text: "2" } },
  ]), [
    { kind: "return", expression: { kind: "number-literal", text: "1" } },
  ]);
});
