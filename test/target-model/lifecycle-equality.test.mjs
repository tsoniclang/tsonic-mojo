import assert from "node:assert/strict";
import test from "node:test";
import { mojoNamedLifecycleEquals } from "../../dist/target-model/lifecycle/equality.js";

const fixed = { kind: "fixed", capabilities: { copy: "explicit", movable: true,
  deinitializable: true, registerPassing: "unavailable", explicitDestruction: false } };

test("lifecycle agreement is semantic rather than record insertion order", () => {
  const reordered = { capabilities: Object.fromEntries(Object.entries(fixed.capabilities).reverse()), kind: "fixed" };
  assert.equal(mojoNamedLifecycleEquals(fixed, reordered), true);
  for (const [key, value] of Object.entries({ copy: "implicit", movable: false,
    deinitializable: false, registerPassing: "register", explicitDestruction: true })) {
    assert.equal(mojoNamedLifecycleEquals(fixed, { ...fixed, capabilities: { ...fixed.capabilities, [key]: value } }), false, key);
  }
});

test("aggregate lifecycle agreement retains all controls and exact parameter positions", () => {
  const aggregate = { kind: "aggregate", genericArgumentIndexes: [0, 2],
    implicitCopyWhenPossible: true, explicitDestruction: false };
  assert.equal(mojoNamedLifecycleEquals(aggregate, { ...aggregate }), true);
  for (const change of [{ genericArgumentIndexes: [2, 0] }, { genericArgumentIndexes: [0] },
    { implicitCopyWhenPossible: false }, { explicitDestruction: true }]) {
    assert.equal(mojoNamedLifecycleEquals(aggregate, { ...aggregate, ...change }), false);
  }
  assert.equal(mojoNamedLifecycleEquals(fixed, aggregate), false);
  assert.equal(mojoNamedLifecycleEquals(aggregate, fixed), false);
});
