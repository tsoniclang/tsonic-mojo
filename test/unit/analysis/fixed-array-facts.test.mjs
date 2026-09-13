import assert from "node:assert/strict";
import test from "node:test";
import { tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import { uniqueFixedArrayFact } from "../../../dist/policy/types/resolution-helpers.js";
import { resolveMojoRetainedType } from "../../../dist/policy/types/resolution-facts.js";

const selectedArray = {};
const selectedElement = {};
const fact = Object.freeze({
  sourceType: selectedArray,
  elementSourceType: selectedElement,
  length: 2n,
  lengthRuntimeBase: "number",
});

test("fixed-array resolution consumes selected element evidence without authored syntax", () => {
  const element = { kind: "source-primitive", name: "uint8" };
  let resolutions = 0;
  const result = resolveMojoRetainedType(selectedArray, undefined, {
    semantics: { facts: { typeSubjects: (type) => [type] } },
    sourceFacts: { getFact: (subject, key) => subject === selectedArray && key === tsonicFixedArrayFactKey ? fact : undefined },
  }, (type, node) => {
    resolutions++;
    assert.equal(type, selectedElement);
    assert.equal(node, undefined);
    return { kind: "resolved", type: element };
  });
  assert.equal(resolutions, 1);
  assert.deepEqual(result, {
    kind: "resolved",
    type: { kind: "fixed-array", element, length: { kind: "integer", value: "2" } },
  });
});

test("fixed-array agreement includes semantic identity and length domain even without authored syntax", () => {
  assert.deepEqual(uniqueFixedArrayFact([undefined, fact, { ...fact }]), { kind: "selected", value: fact });
  for (const mutation of [
    { sourceType: {} },
    { elementSourceType: {} },
    { elementType: {} },
    { length: 3n },
    { lengthRuntimeBase: "bigint" },
  ]) {
    assert.deepEqual(uniqueFixedArrayFact([fact, { ...fact, ...mutation }]), { kind: "conflict" });
  }
});
