import assert from "node:assert/strict";
import test from "node:test";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";
import { mojoValueConversionEquals } from "../../../dist/target-model/conversions/equality.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "native-string" };
const unit = { kind: "unit" };
const parameter = (type) => ({ convention: "imm", passing: "plain", type });
const callable = (types, result = unit) => ({ kind: "callable", parameters: types.map(parameter), result, raises: false });
const classify = (source, target, copy = () => "implicit") =>
  classifyMojoValueConversion(source, target, undefined, undefined, undefined, undefined, copy);

test("callable prefix admission preserves the exact authored and target signatures", () => {
  for (let supplied = 1; supplied <= 6; supplied++) {
    for (let used = 0; used < supplied; used++) {
      const source = callable(Array(used).fill(number));
      const target = callable(Array(supplied).fill(number));
      const selected = classify(source, target);
      assert.equal(selected.kind, "resolved");
      assert.equal(selected.conversion.kind, "callable-adapt");
      assert.equal(selected.conversion.sourceType, source);
      assert.equal(selected.conversion.targetType, target);
      assert.deepEqual(selected.conversion.parameters, { kind: "prefix", copies: Array(used).fill("implicit") });
    }
  }
});

test("callable prefix admission requires exact prefix types, ownership and copy evidence", () => {
  const source = callable([number]);
  for (const target of [callable([]), callable([string, number]), callable([number, string], number)]) {
    assert.equal(classify(source, target).kind, "unsupported");
  }
  for (const convention of ["mut", "ref", "out", "var", "deinit"]) {
    const target = callable([number, string]);
    target.parameters[1] = { ...target.parameters[1], convention };
    assert.equal(classify(source, target).kind, "unsupported", convention);
  }
  const consuming = callable([number, string]);
  consuming.parameters[1].passing = "consume";
  assert.equal(classify(source, consuming).kind, "unsupported");
  const rest = callable([number]);
  rest.parameters[0].omissionKind = "rest";
  assert.equal(classify(rest, callable([number, number])).kind, "unsupported");
  assert.equal(classify(source, callable([number, number]), () => "unavailable").kind, "unsupported");
  assert.equal(classifyMojoValueConversion(source, callable([number, number])).kind, "unsupported");
});

test("callable parameter projections compose with optional slots and exact error widening", () => {
  const source = callable([string], number);
  const target = { ...callable([string, number], number), raises: true };
  const selected = classify(source, { kind: "optional", value: target }, () => "explicit");
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.conversion.kind, "optional-some");
  const conversion = selected.conversion.valueConversion;
  assert.equal(conversion.kind, "callable-adapt");
  assert.equal(conversion.error, "widen");
  assert.deepEqual(conversion.parameters, { kind: "prefix", copies: ["explicit"] });
  assert.equal(classify({ ...source, raises: true }, callable([string, number], number)).kind, "unsupported");
});

test("conversion agreement includes the source signature and each projection disposition", () => {
  const selected = classify(callable([number]), callable([number, string]));
  assert.equal(selected.kind, "resolved");
  const conversion = selected.conversion;
  assert.equal(mojoValueConversionEquals(conversion, { ...conversion }), true);
  for (const change of [
    { sourceType: callable([]) },
    { parameters: { kind: "identity" } },
    { parameters: { kind: "prefix", copies: ["explicit"] } },
    { parameters: { kind: "prefix", copies: [] } },
  ]) {
    assert.equal(mojoValueConversionEquals(conversion, { ...conversion, ...change }), false);
  }
});
