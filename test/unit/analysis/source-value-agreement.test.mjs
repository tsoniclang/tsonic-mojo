import assert from "node:assert/strict";
import test from "node:test";
import { mojoJsValueGraphEquals, mojoValueConversionEquals } from "../../../dist/target-model/conversions/equality.js";
import { sourceValueGenericParameters } from "../../../dist/analysis/conversions/js-value-generics.js";

const numberType = Object.freeze({ kind: "source-primitive", name: "int32" });
const objectType = Object.freeze({ kind: "target-named", id: "proof.Counter", modulePath: ["proof"], name: "Counter" });
const dynamicType = Object.freeze({ kind: "dynamic", domain: "js" });

function graph(declaration) {
  return {
    root: "object",
    definitions: [{
      id: "object", kind: "object", sourceType: objectType, genericParameters: [],
      identity: "project-direct", sourceCopy: "implicit",
      fields: [{ sourceName: "count", projection: "number", access: { kind: "project", declaration, path: ["count"] } }],
      toJson: { declaration, name: "toJSON", passesPropertyKey: false, resultType: numberType, resultProjection: "number" },
    }, {
      id: "number", kind: "scalar", sourceType: numberType, genericParameters: [],
      conversion: { kind: "js-box", source: "number", sourceType: numberType, targetType: dynamicType },
    }],
  };
}

test("source-value agreement compares selected declarations by identity without reading AST fields", () => {
  const selected = new Proxy({}, { get() { throw new Error("AST fields must not be read"); }, ownKeys() { throw new Error("AST fields must not be enumerated"); } });
  const other = new Proxy({}, { get() { throw new Error("AST fields must not be read"); }, ownKeys() { throw new Error("AST fields must not be enumerated"); } });
  assert.equal(mojoJsValueGraphEquals(graph(selected), graph(selected)), true);
  assert.equal(mojoJsValueGraphEquals(graph(selected), graph(other)), false);
  const left = { kind: "optional-some", targetType: { kind: "optional", value: dynamicType }, valueConversion: {
    kind: "js-value-graph", sourceType: objectType, targetType: dynamicType, graph: graph(selected),
  } };
  const right = { ...left, valueConversion: { ...left.valueConversion, graph: graph(other) } };
  assert.equal(mojoValueConversionEquals(left, right), false);
});

test("source-value agreement detects each changed field, storage, identity and method control", () => {
  const declaration = Object.freeze({});
  for (const mutate of [
    (value) => { value.root = "number"; },
    (value) => { value.definitions[0].identity = "project-erased"; },
    (value) => { value.definitions[0].sourceCopy = "explicit"; },
    (value) => { value.definitions[0].fields[0].sourceName = "other"; },
    (value) => { value.definitions[0].fields[0].access.path = ["_base", "count"]; },
    (value) => { value.definitions[0].fields[0].projection = "object"; },
    (value) => { value.definitions[0].toJson.passesPropertyKey = true; },
    (value) => { value.definitions[0].toJson.resultProjection = "object"; },
  ]) {
    const changed = graph(declaration);
    mutate(changed);
    assert.equal(mojoJsValueGraphEquals(graph(declaration), changed), false);
  }
});

test("phantom source-value parameters retain their exact authored constraints", () => {
  const parameter = { identity: "proof.parameter.T", name: "T", kind: "type", position: "positional", variadic: false, constraints: [numberType] };
  const type = { ...objectType, genericArguments: [{ kind: "type", type: { kind: "type-parameter", name: "T", identity: parameter.identity } }] };
  assert.deepEqual(sourceValueGenericParameters(type, new Map([[parameter.identity, parameter]])), [parameter]);
  assert.equal(sourceValueGenericParameters(type, new Map([["different.identity", parameter]])), undefined);
  assert.equal(sourceValueGenericParameters({ ...type, genericArguments: [{ kind: "type", type: { kind: "type-parameter", name: "T" } }] }, new Map([[parameter.identity, parameter]])), undefined);
});
