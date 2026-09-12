import assert from "node:assert/strict";
import test from "node:test";
import { mojoTargetTypeEquals } from "../../../dist/target-model/types/equality.js";
import { mojoTargetTypeKey } from "../../../dist/target-model/types/key.js";

const number = { kind: "source-primitive", name: "float64" };
const text = { kind: "native-string" };
const named = { kind: "target-named", id: "example.Record", modulePath: ["example"], name: "Record" };
const parameter = { name: "value", convention: "imm", passing: "plain", type: number };
const callable = { kind: "callable", parameters: [parameter], result: text, raises: false };

function reverseFields(value) {
  if (Array.isArray(value)) return value.map(reverseFields);
  return value !== null && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([name, member]) => [name, reverseFields(member)]))
    : value;
}

test("type keys preserve equality across field order, omitted defaults and callable parameter names", () => {
  const equivalent = [
    [named, { ...named, genericArguments: [] }],
    [named, { ...named, lifecycleRequirement: "copyable" }],
    [callable, { ...callable, parameters: [{ ...parameter, name: "other", omissionKind: "required" }] }],
    [{ ...callable, raises: true }, { ...callable, raises: true,
      errorType: { kind: "target-named", id: "mojo.builtin.Error", modulePath: [], name: "Error" } }],
  ];
  for (const [left, right] of equivalent) {
    assert.equal(mojoTargetTypeEquals(left, right), true);
    assert.equal(mojoTargetTypeKey(left), mojoTargetTypeKey(reverseFields(right)));
  }
});

test("canonical keys are congruent with every current target type identity form", () => {
  const origins = [
    { kind: "static" }, { kind: "inferred" },
    { kind: "parameter", name: "input" }, { kind: "untracked", mutable: false },
    { kind: "unsafe", mutable: true },
    { kind: "provider-expression", tokens: [{ kind: "identifier", text: "input" }] },
  ];
  const generics = [
    { kind: "type", type: number }, { kind: "type-expression", expression: "Self.Item" },
    { kind: "compiler-expression", expression: "size_of[Int]()" },
    { kind: "static-string", value: "example" }, { kind: "integer", value: "12" },
    { kind: "boolean", value: true }, { kind: "value-reference", path: ["example", "count"] },
    { kind: "origin", origin: { kind: "parameter", name: "input" } }, { kind: "unbound" },
  ];
  const types = [number, text, named, callable,
    ...["unit", "never", "null", "undefined", "bigint", "symbol"].map((kind) => ({ kind })),
    ...["source", "js"].map((domain) => ({ kind: "dynamic", domain })),
    { kind: "type-parameter", name: "T", identity: "owner.T" },
    { kind: "list", element: number },
    ...[{ kind: "integer", value: "4" }, { kind: "boolean", value: true },
      { kind: "parameter", name: "Size" }].map((length) => ({ kind: "fixed-array", element: number, length })),
    { kind: "dictionary", key: text, value: number },
    { kind: "future", domain: "native", raises: false, output: number },
    { kind: "optional", value: number }, { kind: "union", members: [number, text] },
    { kind: "tuple", elements: [text, number] }, { kind: "compiler-expression", expression: "Self.Item" },
    { kind: "associated", owner: named, memberPath: ["Item"], genericArguments: generics },
    ...origins.map((origin) => ({ kind: "reference", value: named, mutable: false, origin })),
    ...generics.map((argument) => ({ ...named, genericArguments: [argument] })),
    { kind: "function", thin: true, asynchronous: false, raises: false,
      parameters: [parameter], result: number, genericParameters: [{ kind: "type", name: "T",
        position: "positional", variadic: false, constraints: [named], defaultArgument: generics[0] }] },
  ];
  for (const left of types) for (const right of types) {
    assert.equal(mojoTargetTypeKey(left) === mojoTargetTypeKey(reverseFields(right)),
      mojoTargetTypeEquals(left, right), JSON.stringify([left, right]));
  }
  for (const changed of [
    { ...named, id: "other.Record" }, { ...named, modulePath: ["other"] },
    { ...named, name: "Other" }, { ...named, genericArguments: [{ kind: "type", type: number }] },
  ]) assert.notEqual(mojoTargetTypeKey(named), mojoTargetTypeKey(changed));
  assert.notEqual(mojoTargetTypeKey({ kind: "union", members: [text, number] }),
    mojoTargetTypeKey({ kind: "union", members: [number, text] }));
  assert.notEqual(mojoTargetTypeKey(callable), mojoTargetTypeKey({ ...callable, raises: true }));
});
