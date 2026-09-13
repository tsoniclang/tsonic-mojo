import assert from "node:assert/strict";
import test from "node:test";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";
import { mojoTargetTypeEquals } from "../../../dist/target-model/types/equality.js";

const string = { kind: "native-string" };
const optional = { kind: "optional", value: string };
const callable = (omissionKind, type = optional) => ({
  kind: "callable", raises: false, result: string,
  parameters: [{ type, omissionKind, convention: "imm", passing: "plain" }],
});

test("callable defaults belong to the body while optional invocation slots share an ABI", () => {
  const initialized = callable("initializer");
  const omitted = callable("undefined");
  assert.equal(mojoTargetTypeEquals(initialized, omitted), false);
  for (const [source, target] of [[initialized, omitted], [omitted, initialized]]) {
    const selected = classifyMojoValueConversion(source, target);
    assert.equal(selected.kind, "resolved");
    assert.equal(selected.conversion.kind, "callable-adapt");
    assert.deepEqual(selected.conversion.parameters, { kind: "identity" });
    assert.equal(selected.conversion.sourceType, source);
    assert.equal(selected.conversion.targetType, target);
  }
});

test("default-slot equivalence does not invent required, rest or ownership conversions", () => {
  const initialized = callable("initializer");
  for (const target of [callable("required"), callable("rest"), callable("undefined", string),
    { ...callable("undefined"), parameters: [{ ...callable("undefined").parameters[0], convention: "mut" }] }]) {
    assert.equal(classifyMojoValueConversion(initialized, target).kind, "unsupported");
  }
});
