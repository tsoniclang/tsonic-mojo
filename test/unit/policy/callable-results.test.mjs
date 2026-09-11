import assert from "node:assert/strict";
import test from "node:test";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";
import { mojoValueConversionEquals } from "../../../dist/target-model/conversions/equality.js";
import { mojoValueConversionRepresentationTypes } from "../../../dist/target-model/conversions/representation-types.js";

const bool = { kind: "source-primitive", name: "bool" };
const string = { kind: "native-string" };
const union = { kind: "union", members: [bool, string] };
const callable = (result, raises = false) => ({ kind: "callable", parameters: [], result, raises });

test("selected callback result covariance retains its conversion and independent error widening", () => {
  const selected = classifyMojoValueConversion(callable(bool), callable(union, true));
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.conversion.kind, "callable-adapt");
  assert.equal(selected.conversion.result, "convert");
  assert.equal(selected.conversion.resultConversion.kind, "union-inject");
  assert.equal(selected.conversion.error, "widen");
  assert.ok(mojoValueConversionRepresentationTypes(selected.conversion).some((type) => type === union));
  assert.equal(mojoValueConversionEquals(selected.conversion, { ...selected.conversion, resultConversion: { kind: "identity" } }), false);
});

test("callback result adaptation preserves rejection for absent conversions and raising projections", () => {
  assert.equal(classifyMojoValueConversion(callable(bool), callable(string)).kind, "unsupported");
  const jsString = { kind: "target-named", id: "tsonic.mojo.js.JsString", modulePath: ["tsonic_js"], name: "JsString" };
  assert.equal(classifyMojoValueConversion(callable(jsString), callable(string)).kind, "unsupported");
  assert.equal(classifyMojoValueConversion(callable(bool, true), callable(union)).kind, "unsupported");
  const parameter = { type: bool, convention: "imm", passing: "plain" };
  assert.equal(classifyMojoValueConversion({ ...callable(bool), parameters: [parameter] }, callable(union)).kind, "unsupported");
});
