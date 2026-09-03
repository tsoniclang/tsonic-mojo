import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeMojoExpression,
  normalizeMojoStatements,
} from "../../../dist/backend/normalization/index.js";

function numericConstruction(target, text) {
  return {
    kind: "construct",
    type: target,
    arguments: [{
      value: {
        kind: "construct",
        type: { kind: "source-primitive", name: "float64" },
        arguments: [{ value: { kind: "number-literal", text } }],
      },
    }],
  };
}

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

test("normalization removes an exact redundant floating carrier around integer literals", () => {
  assert.deepEqual(
    normalizeMojoExpression(numericConstruction(
      { kind: "source-primitive", name: "int32" },
      "7",
    )),
    {
      kind: "construct",
      type: { kind: "source-primitive", name: "int32" },
      arguments: [{ value: { kind: "number-literal", text: "7" } }],
    },
  );
  assert.deepEqual(
    normalizeMojoExpression(numericConstruction(
      { kind: "source-primitive", name: "native-int" },
      "0",
    )),
    {
      kind: "construct",
      type: { kind: "source-primitive", name: "native-int" },
      arguments: [{ value: { kind: "number-literal", text: "0" } }],
    },
  );
});

test("normalization preserves floating and non-exact numeric conversions", () => {
  const decimal = numericConstruction({ kind: "source-primitive", name: "float32" }, "0.1");
  const unsafeInteger = numericConstruction(
    { kind: "source-primitive", name: "int128" },
    "9007199254740992",
  );
  assert.deepEqual(normalizeMojoExpression(decimal), decimal);
  assert.deepEqual(normalizeMojoExpression(unsafeInteger), unsafeInteger);
});
