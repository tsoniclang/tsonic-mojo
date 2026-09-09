import assert from "node:assert/strict";
import test from "node:test";
import { parameterBindingConversions } from "../../../dist/analysis/operations/call-argument-conversions.js";

test("parameter conversion policies attach to exact selected binding objects", () => {
  const first = Object.freeze({ sourceArgumentIndex: 0, sourceParameterIndex: 0, sourceForm: "value" });
  const second = Object.freeze({ sourceArgumentIndex: 1, sourceParameterIndex: 1, sourceForm: "value" });
  const firstConversion = Object.freeze({ kind: "identity" });
  const secondConversion = Object.freeze({ kind: "native-to-js-string", targetType: Object.freeze({ kind: "dynamic", domain: "js" }) });
  const selected = parameterBindingConversions({ sourceArgumentBindings: [first, second] }, new Map([
    [0, firstConversion], [1, secondConversion],
  ]));
  assert.equal(selected.get(first), firstConversion);
  assert.equal(selected.get(second), secondConversion);
  assert.equal(selected.get(0), undefined);
  assert.equal(selected.get({ ...first }), undefined);
});

test("expanded rest bindings remain independently addressable", () => {
  const bindings = [0, 1, 2].map((sourceArgumentIndex) => Object.freeze({
    sourceArgumentIndex, sourceParameterIndex: 0, sourceForm: "value",
  }));
  const conversion = Object.freeze({ kind: "identity" });
  const selected = parameterBindingConversions({ sourceArgumentBindings: bindings }, new Map([[0, conversion]]));
  assert.equal(selected.size, 3);
  for (const binding of bindings) assert.equal(selected.get(binding), conversion);
  const distinct = new Map(selected);
  const refinement = Object.freeze({ kind: "js-to-native-string" });
  distinct.set(bindings[1], refinement);
  assert.equal(distinct.get(bindings[0]), conversion);
  assert.equal(distinct.get(bindings[1]), refinement);
  assert.equal(distinct.get(bindings[2]), conversion);
});

test("omitted parameters do not manufacture argument occurrences", () => {
  const binding = Object.freeze({ sourceArgumentIndex: 0, sourceParameterIndex: 0, sourceForm: "value" });
  assert.equal(parameterBindingConversions({ sourceArgumentBindings: [binding] }, new Map([[1, { kind: "identity" }]])).size, 0);
  assert.equal(parameterBindingConversions({ sourceArgumentBindings: [] }, new Map([[0, { kind: "identity" }]])).size, 0);
});
