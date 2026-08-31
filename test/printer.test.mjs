import assert from "node:assert/strict";
import test from "node:test";
import { printMojoModule } from "../dist/backend/emission/printer.js";

test("printer emits assignment as a statement and keeps expressions structured", () => {
  const module = {
    imports: [],
    functions: [{
      name: "increment",
      parameters: [{ name: "value", type: { kind: "source-primitive", name: "int32" } }],
      resultType: { kind: "source-primitive", name: "int32" },
      raises: false,
      statements: [
        {
          kind: "assignment",
          operator: "+=",
          left: { kind: "path", path: "value" },
          right: { kind: "number-literal", text: "1" },
        },
        { kind: "return", expression: { kind: "path", path: "value" } },
      ],
    }],
  };
  assert.equal(
    printMojoModule(module),
    [
      "def increment(value: Int32) -> Int32:",
      "    value += 1",
      "    return value",
      "",
    ].join("\n"),
  );
});

test("printer emits explicit JS string construction", () => {
  const jsString = {
    kind: "target-named",
    id: "tsonic.mojo.js.JsString",
    modulePath: ["tsonic_js"],
    name: "JsString",
  };
  const module = {
    imports: ["tsonic_js"],
    functions: [{
      name: "message",
      parameters: [],
      resultType: jsString,
      raises: false,
      statements: [{
        kind: "return",
        expression: {
          kind: "construct",
          type: jsString,
          arguments: [{ value: { kind: "string-literal", value: "hello" } }],
        },
      }],
    }],
  };
  assert.match(printMojoModule(module), /return tsonic_js\.JsString\("hello"\)/u);
});
