import assert from "node:assert/strict";
import test from "node:test";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";
import { classifyTruthiness } from "../../../dist/policy/conversions/truthiness.js";

test("boolean truthiness preserves payloads through optional and union carriers", () => {
  const bool = { kind: "source-primitive", name: "bool" };
  const optional = { kind: "optional", value: bool };
  assert.deepEqual(classifyMojoValueConversion(bool, bool), {
    kind: "resolved", conversion: { kind: "identity" },
  });
  assert.deepEqual(classifyMojoValueConversion(optional, bool), {
    kind: "resolved",
    conversion: {
      kind: "js-truthiness",
      conversion: { kind: "optional", sourceType: optional, value: { kind: "boolean" } },
    },
  });
  const union = { kind: "union", members: [bool, { kind: "native-string" }] };
  assert.deepEqual(classifyTruthiness(union), {
    kind: "union", sourceType: union,
    members: [
      { type: bool, conversion: { kind: "boolean" } },
      { type: { kind: "native-string" }, conversion: { kind: "native-string" } },
    ],
  });
});
