import assert from "node:assert/strict";
import test from "node:test";
import { retainMojoValue } from "../../../dist/backend/planner/expressions/value-plan.js";

test("owning payloads preserve fresh aggregate literals and retain borrowed storage", () => {
  const type = { kind: "list", element: { kind: "native-string" } };
  const lifecycle = { capabilities: () => ({ copy: "explicit" }) };
  for (const value of [
    { kind: "list", elements: [] },
    { kind: "tuple", elements: [] },
    { kind: "dictionary", entries: [] },
    { kind: "construct", type, arguments: [] },
    { kind: "copy", expression: { kind: "path", path: "payload" } },
    { kind: "consume", expression: { kind: "path", path: "payload" } },
  ]) assert.equal(retainMojoValue(value, type, lifecycle), value);
  for (const value of [
    { kind: "path", path: "payload" },
    { kind: "member", receiver: { kind: "path", path: "owner" }, name: "payload" },
    { kind: "method-call", receiver: { kind: "path", path: "optional" }, name: "value", arguments: [] },
  ]) assert.deepEqual(retainMojoValue(value, type, lifecycle), { kind: "copy", expression: value });
});
