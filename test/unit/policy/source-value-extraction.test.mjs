import assert from "node:assert/strict";
import test from "node:test";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";

test("checked primitive recovery uses the canonical source-value extraction policy", () => {
  const source = { kind: "dynamic", domain: "js" };
  for (const [target, name] of [
    [{ kind: "source-primitive", name: "float64" }, "js_value_number"],
    [{ kind: "native-string" }, "js_value_native_string"],
    [{ kind: "null" }, "js_value_null"],
    [{ kind: "undefined" }, "js_value_undefined"],
  ]) {
    const result = classifyMojoValueConversion(source, target);
    assert.equal(result.kind, "resolved");
    assert.equal(result.conversion.kind, "js-value-extract");
    assert.equal(result.conversion.extraction.name, name);
  }
  assert.deepEqual(classifyMojoValueConversion(source, { kind: "source-primitive", name: "bool" }), {
    kind: "resolved", conversion: { kind: "js-truthiness", conversion: { kind: "dynamic" } },
  });
  for (const target of [
    { kind: "source-primitive", name: "int32" },
    { kind: "optional", value: { kind: "source-primitive", name: "float64" } },
    { kind: "target-named", id: "unrelated", modulePath: ["foreign"], name: "Record" },
  ]) assert.equal(classifyMojoValueConversion(source, target).kind, "unsupported");
  assert.equal(classifyMojoValueConversion(
    { kind: "dynamic", domain: "source" }, { kind: "source-primitive", name: "float64" },
  ).kind, "unsupported");
});
