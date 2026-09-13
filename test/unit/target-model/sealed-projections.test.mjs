import assert from "node:assert/strict";
import test from "node:test";
import { mojoParameterArgumentDisposition, mojoParameterConvention } from "../../../dist/target-model/operations/parameters.js";
import { mojoConvertedValueType } from "../../../dist/target-model/conversions/result.js";

test("sealed parameter projections preserve independent local-copy and passing choices", () => {
  const cases = [
    [{ kind: "immutable", localCopy: false }, "imm", "plain"],
    [{ kind: "immutable", localCopy: true }, "imm", "plain"],
    [{ kind: "mutable-reference" }, "mut", "plain"],
    [{ kind: "parametric-reference" }, "ref", "plain"],
    [{ kind: "owned" }, "var", "transfer"],
    [{ kind: "out" }, "out", "plain"],
  ];
  for (const [disposition, convention, argumentKind] of cases) {
    Object.freeze(disposition);
    assert.equal(mojoParameterConvention(disposition), convention);
    const argument = mojoParameterArgumentDisposition(disposition);
    assert.deepEqual(argument, { kind: argumentKind });
    assert.equal(Object.isFrozen(argument), true);
  }
});

test("sealed result projection preserves exact input or selected target identity", () => {
  const input = Object.freeze({ kind: "source-primitive", name: "int32" });
  const targetType = Object.freeze({ kind: "source-primitive", name: "float64" });
  assert.equal(mojoConvertedValueType(input, { kind: "identity" }), input);
  assert.deepEqual(mojoConvertedValueType(input, { kind: "js-to-native-string" }), { kind: "native-string" });
  assert.deepEqual(mojoConvertedValueType(input, {
    kind: "js-truthiness", conversion: { kind: "integer" },
  }), { kind: "source-primitive", name: "bool" });
  for (const kind of ["primitive-cast", "reference-copy", "native-error-result-unwrap"]) {
    assert.equal(mojoConvertedValueType(input, { kind, sourceType: input, targetType }), targetType);
  }
});
