import assert from "node:assert/strict";
import test from "node:test";
import { createMojoNullableReceiverView } from "../../../dist/analysis/representations/receivers.js";

const first = Object.freeze({ kind: "target-named", id: "proof.First", modulePath: ["proof"], name: "First" });
const second = Object.freeze({ kind: "target-named", id: "proof.Second", modulePath: ["proof"], name: "Second" });
const third = Object.freeze({ kind: "target-named", id: "proof.Third", modulePath: ["proof"], name: "Third" });
const absent = Object.freeze({ kind: "undefined" });
const nil = Object.freeze({ kind: "null" });
const union = (...members) => Object.freeze({ kind: "union", members: Object.freeze(members) });
const optional = (value) => Object.freeze({ kind: "optional", value });
const carriers = Object.freeze({ carrierForType: (type) => JSON.stringify(type) });

test("nullable receiver analysis keeps physical storage and closes only selected present alternatives", () => {
  const physical = union(first, second, third, absent, nil);
  const view = createMojoNullableReceiverView(union(first, second, absent, nil), physical, carriers);
  assert.equal(view.kind, "union");
  assert.equal(view.carrier, carriers.carrierForType(physical));
  assert.equal(view.value.type, physical);
  assert.deepEqual(view.absent.map(({ type }) => type), [absent, nil]);
  assert.equal(view.present.kind, "union-subset");
  assert.deepEqual(view.present.allowedAlternatives.map(({ type }) => type), [first, second]);
});

test("a nullable single project value selects one exact present native alternative", () => {
  const view = createMojoNullableReceiverView(union(first, nil), union(first, nil), carriers);
  assert.equal(view.kind, "union");
  assert.equal(view.present.kind, "union-member");
  assert.equal(view.value.type, first);
  const optionalView = createMojoNullableReceiverView(optional(first), optional(first), carriers);
  assert.equal(optionalView.kind, "optional");
  assert.equal(optionalView.value.type, first);
  const presentUnion = union(first, second, nil);
  const nestedView = createMojoNullableReceiverView(optional(presentUnion), optional(presentUnion), carriers);
  assert.equal(nestedView.kind, "optional");
  assert.equal(nestedView.value.type, presentUnion);
  assert.equal(nestedView.nested.kind, "union");
  assert.deepEqual(nestedView.nested.absent.map(({ type }) => type), [nil]);
});

test("a source-proven non-null union subset needs no optional guard", () => {
  assert.equal(createMojoNullableReceiverView(union(first, second), union(first, second, nil), carriers), undefined);
});

test("mutating either side of nullable storage evidence cannot fabricate a presence projection", () => {
  assert.throws(() => createMojoNullableReceiverView(union(first, absent), union(first, second), carriers), /physical present-value projection/u);
  assert.throws(() => createMojoNullableReceiverView(union(first, absent), union(second, absent), carriers), /physical present-value projection/u);
  assert.throws(() => createMojoNullableReceiverView(optional(first), optional(second), carriers), /Optional storage/u);
});
