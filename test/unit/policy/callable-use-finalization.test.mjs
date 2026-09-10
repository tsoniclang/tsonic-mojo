import assert from "node:assert/strict";
import test from "node:test";
import { createMojoConversionIndex } from "../../../dist/policy/conversions/selection.js";

const nativeError = { kind: "target-named", id: "mojo.builtin.Error", modulePath: [], name: "Error" };
const authoredError = { kind: "target-named", id: "fixture.Error", modulePath: ["fixture"], name: "Failure" };
const broadError = { kind: "union", members: [nativeError, authoredError] };
const callable = (errorType) => ({ kind: "callable", parameters: [], result: { kind: "native-string" }, raises: true, errorType });

function index() {
  return createMojoConversionIndex({
    narrowingForExpression: () => undefined,
    projectRelationships: undefined,
    sourceValueProjection: () => ({ kind: "unsupported", reason: "not a source-value fixture" }),
    parameterCopy: () => "implicit",
  });
}

test("final effects replace provisional identity at every recorded callable destination", () => {
  const conversions = index();
  const expression = {};
  const expected = callable(broadError);
  const optional = { kind: "optional", value: expected };
  assert.equal(conversions.record(expression, expected, expected).conversion.kind, "identity");
  assert.equal(conversions.record(expression, expected, optional).kind, "resolved");
  assert.deepEqual(conversions.finalizeCallableSource(expression, callable(authoredError)), []);
  assert.deepEqual(conversions.finalizeCallableSource(expression, callable(authoredError)), []);
  assert.equal(conversions.get(expression, expected).kind, "callable-adapt");
  assert.equal(conversions.get(expression, callable(authoredError)).kind, "identity");
  assert.notEqual(conversions.get(expression, optional), undefined);
  assert.throws(() => conversions.finalizeCallableSource(expression, callable(authoredError)), /sealed/u);
});

test("finalized callable conversions reject contradictory source effects", () => {
  const conversions = index();
  const expression = {};
  const expected = callable(broadError);
  conversions.record(expression, expected, expected);
  assert.deepEqual(conversions.finalizeCallableSource(expression, callable(authoredError)), []);
  assert.match(conversions.finalizeCallableSource(expression, callable(nativeError)).join("\n"), /contradictory finalized/u);
});
