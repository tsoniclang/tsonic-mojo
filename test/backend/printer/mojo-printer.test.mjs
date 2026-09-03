import assert from "node:assert/strict";
import test from "node:test";
import { printMojoModule } from "../../../dist/print/source/index.js";
import { mojoTargetTypeKey } from "../../../dist/target-model/types/key.js";

test("printer emits assignment as a statement and keeps expressions structured", () => {
  const module = {
    modulePath: [],
    imports: [],
    typeAliases: [],
    declarations: [{
      kind: "function",
      name: "increment",
      genericParameters: [],
      parameters: [{ name: "value", type: { kind: "source-primitive", name: "int32" } }],
      resultType: { kind: "source-primitive", name: "int32" },
      asynchronous: false,
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
    modulePath: [],
    imports: [{ kind: "module", modulePath: ["tsonic_js"] }],
    typeAliases: [],
    declarations: [{
      kind: "function",
      name: "message",
      genericParameters: [],
      parameters: [],
      resultType: jsString,
      asynchronous: false,
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

test("printer emits typed declarations and structured control flow", () => {
  const int32 = { kind: "source-primitive", name: "int32" };
  const module = {
    modulePath: [],
    imports: [{
      kind: "symbols",
      modulePath: ["std", "collections"],
      symbols: [{ name: "List" }, { name: "Optional", alias: "Maybe" }],
    }],
    typeAliases: [],
    declarations: [{
      kind: "struct",
      name: "Counter",
      genericParameters: [],
      conformances: [],
      fields: [{ name: "value", type: int32, compileTime: false }],
      methods: [{
        kind: "function",
        name: "increment",
        genericParameters: [],
        parameters: [{ name: "self", type: { kind: "target-named", id: "counter", modulePath: [], name: "Counter" }, convention: "mut" }],
        resultType: int32,
        asynchronous: false,
        raises: false,
        statements: [{
          kind: "assignment",
          operator: "+=",
          left: { kind: "member", receiver: { kind: "path", path: "self" }, name: "value" },
          right: { kind: "number-literal", text: "1" },
        }, {
          kind: "return",
          expression: { kind: "member", receiver: { kind: "path", path: "self" }, name: "value" },
        }],
      }],
    }],
  };
  assert.equal(
    printMojoModule(module),
    [
      "from std.collections import List, Optional as Maybe",
      "",
      "struct Counter:",
      "    var value: Int32",
      "",
      "    def increment(mut self: Counter) -> Int32:",
      "        self.value += 1",
      "        return self.value",
      "",
    ].join("\n"),
  );
});

test("printer renders generated generic values from typed syntax", () => {
  const module = {
    modulePath: ["fixture"],
    imports: [{ kind: "module", modulePath: ["tsonic_runtime"] }],
    typeAliases: [],
    declarations: [{
      kind: "comptime",
      name: "stateCell",
      genericParameters: [],
      initializer: {
        kind: "construct",
        type: {
          kind: "target-named",
          id: "tsonic.mojo.runtime.GlobalCell",
          modulePath: ["tsonic_runtime"],
          name: "GlobalCell",
          genericArguments: [
            { kind: "static-string", value: "module.😀" },
            { kind: "value-reference", path: ["fixture", "createState"] },
          ],
        },
        arguments: [],
      },
    }],
  };
  assert.equal(
    printMojoModule(module),
    [
      "import tsonic_runtime",
      "",
      "comptime stateCell = tsonic_runtime.GlobalCell[",
      '    "module.😀",',
      "    fixture.createState,",
      "]()",
      "",
    ].join("\n"),
  );
});

test("printer emits closed numeric enums as native compile-time value families", () => {
  const enumType = {
    kind: "target-named",
    id: "fixture.Mode",
    modulePath: ["fixture"],
    name: "Mode",
  };
  const module = {
    modulePath: ["fixture"],
    imports: [],
    typeAliases: [],
    declarations: [{
      kind: "struct",
      name: "Mode",
      genericParameters: [],
      conformances: [
        { kind: "target-named", id: "mojo.builtin.Equatable", modulePath: [], name: "Equatable" },
        {
          kind: "target-named",
          id: "mojo.builtin.TrivialRegisterPassable",
          modulePath: [],
          name: "TrivialRegisterPassable",
        },
      ],
      fields: [
        { name: "value", type: { kind: "source-primitive", name: "int64" }, compileTime: false },
        {
          name: "Off",
          type: enumType,
          compileTime: true,
          initializer: {
            kind: "construct",
            type: enumType,
            arguments: [{ value: { kind: "number-literal", text: "0" } }],
          },
        },
        {
          name: "On",
          type: enumType,
          compileTime: true,
          initializer: {
            kind: "construct",
            type: enumType,
            arguments: [{ value: { kind: "number-literal", text: "4" } }],
          },
        },
      ],
      methods: [],
      decorators: ["fieldwise-init"],
    }],
  };
  assert.equal(
    printMojoModule(module),
    [
      "@fieldwise_init",
      "struct Mode(Equatable, TrivialRegisterPassable):",
      "    var value: Int64",
      "    comptime Off: Mode = Mode(0)",
      "    comptime On: Mode = Mode(4)",
      "",
    ].join("\n"),
  );
});

test("printer uses one selected alias application for a complex carrier", () => {
  const typeParameter = { kind: "type-parameter", name: "T", identity: "type:T" };
  const tuple = { kind: "tuple", elements: [typeParameter, typeParameter, typeParameter, typeParameter] };
  const module = {
    modulePath: ["fixture"],
    imports: [],
    typeAliases: [{
      typeKey: mojoTargetTypeKey(tuple),
      name: "Quad",
      genericArguments: [{ kind: "type", type: typeParameter }],
    }],
    declarations: [{
      kind: "function",
      name: "preserve",
      genericParameters: [{
        kind: "type",
        name: "T",
        position: "positional-or-keyword",
        variadic: false,
        constraints: [],
      }],
      parameters: [{ name: "value", type: tuple }],
      resultType: tuple,
      asynchronous: false,
      raises: false,
      statements: [{ kind: "return", expression: { kind: "path", path: "value" } }],
    }],
  };
  const generated = printMojoModule(module);
  assert.match(generated, /def preserve\[T: AnyType\]\(value: Quad\[T\]\) -> Quad\[T\]:/u);
});
