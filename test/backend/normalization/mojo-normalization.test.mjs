import assert from "node:assert/strict";
import test from "node:test";

test("normalization removes successors only when a try region cannot continue", () => {
  const fail = {
    kind: "expression", neverReturns: true,
    expression: { kind: "call", callee: { kind: "path", path: "fail" }, arguments: [] },
  };
  const next = { kind: "return" };
  const terminal = {
    kind: "try", statements: [fail],
    catches: [{ name: "error", statements: [{ kind: "raise", expression: { kind: "path", path: "error" } }] }],
  };
  assert.deepEqual(normalizeMojoStatements([terminal, next]), [terminal]);
  const recovering = { ...terminal, catches: [{ name: "error", statements: [{ kind: "pass" }] }] };
  assert.deepEqual(normalizeMojoStatements([recovering, next]), [recovering, next]);
  const ordinary = { ...fail, neverReturns: false };
  assert.deepEqual(normalizeMojoStatements([ordinary, next]), [ordinary, next]);
});
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

test("constant branches flatten only when termination makes the destruction boundary identical", () => {
  const terminal = [{ kind: "return", expression: { kind: "number-literal", text: "1" } }];
  const branch = {
    kind: "if", condition: { kind: "bool-literal", value: true }, thenStatements: terminal,
  };
  assert.deepEqual(normalizeMojoStatements([branch]), terminal);
  assert.deepEqual(normalizeMojoStatements([{ ...branch, condition: { kind: "bool-literal", value: false } }]), []);
  const scoped = { ...branch, thenStatements: [{ kind: "variable", name: "owned", initializer: {
    kind: "call", callee: { kind: "path", path: "allocate" }, arguments: [],
  } }] };
  assert.deepEqual(normalizeMojoStatements([scoped, ...terminal]), [scoped, ...terminal]);
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

test("normalization puts exact integer alternatives in their selected carrier without floating intermediates", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const floating = (text) => numericConstruction(int32, text).arguments[0].value;
  const conditional = {
    kind: "conditional", condition: { kind: "path", path: "before" },
    whenTrue: { kind: "unary", operator: "-", operand: floating("1") },
    whenFalse: {
      kind: "conditional", condition: { kind: "path", path: "after" },
      whenTrue: floating("1"), whenFalse: floating("0"),
    },
  };
  const source = { kind: "construct", type: int32, arguments: [{ value: conditional }] };
  const result = normalizeMojoExpression(source);
  assert.equal(result.kind, "conditional");
  assert.equal(result.whenTrue.type.name, "int32");
  assert.equal(result.whenTrue.arguments[0].value.operator, "-");
  assert.equal(result.whenFalse.whenFalse.arguments[0].value.text, "0");
  assert.doesNotMatch(JSON.stringify(result), /float64/u);
  for (const replacement of [floating("0.1"), { kind: "call", callee: { kind: "path", path: "read" }, arguments: [] }]) {
    const retained = { ...source, arguments: [{ value: { ...conditional, whenFalse: replacement } }] };
    assert.deepEqual(normalizeMojoExpression(retained), retained);
  }
});
