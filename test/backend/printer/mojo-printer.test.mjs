import assert from "node:assert/strict";
import test from "node:test";
import { printMojoModule } from "../../../dist/print/source/index.js";
import { mojoTargetTypeKey } from "../../../dist/target-model/types/key.js";

function statementModule(statements) {
  return {
    modulePath: [], imports: [], typeAliases: [],
    declarations: [{
      kind: "function", name: "choose", genericParameters: [], parameters: [],
      resultType: { kind: "source-primitive", name: "bool" },
      asynchronous: false, raises: false, statements,
    }],
  };
}

test("printer separates top-level compound declarations with two blank lines", () => {
  const module = statementModule([{ kind: "pass" }]);
  module.imports = [{ kind: "module", modulePath: ["example"] }];
  module.declarations.push({ ...module.declarations[0], name: "second" });
  const printed = printMojoModule(module);
  assert.match(printed, /import example\n\n\ndef choose/u);
  assert.match(printed, /    pass\n\n\ndef second/u);
});

test("printer keeps an early type annotation flat when the initializer can break", () => {
  const module = statementModule([{
    kind: "variable", name: "candidate",
    type: { kind: "optional", value: { kind: "source-primitive", name: "float64" } },
    initializer: {
      kind: "call", callee: { kind: "path", path: "create_optional" },
      arguments: [{ value: { kind: "path", path: "selected_argument_with_a_long_but_meaningful_name" } }],
    },
  }]);
  module.imports = [{ kind: "symbols", modulePath: ["std", "collections"], symbols: [{ name: "Optional" }] }];
  const printed = printMojoModule(module);
  assert.match(printed, /var candidate: Optional\[Float64\] = create_optional\(\n/u);
  assert.doesNotMatch(printed, /Optional\[\n/u);
});

test("printer can break a long result annotation without changing the type", () => {
  const module = statementModule([{ kind: "pass" }]);
  module.declarations[0] = {
    ...module.declarations[0], name: "selected_operation_operation_operation_operation_closed", raises: true,
    errorType: { kind: "target-named", id: "error", modulePath: [], name: "Error" },
  };
  assert.match(printMojoModule(module), / raises Error -> \(\n    Bool\n\):/u);
});

test("printer orders conformance syntax canonically without changing the selected set", () => {
  const module = {
    modulePath: [], imports: [], typeAliases: [],
    declarations: [{
      kind: "struct", name: "Value", genericParameters: [], fields: [], methods: [],
      conformances: ["ImplicitlyCopyable", "Equatable"].map((name) => ({
        kind: "target-named", id: name, modulePath: [], name,
      })),
    }],
  };
  assert.match(printMojoModule(module), /struct Value\(Equatable, ImplicitlyCopyable\):/u);
  assert.equal(module.declarations[0].conformances[0].name, "ImplicitlyCopyable");
});

test("printer separates a terminal nested try from its containing finally", () => {
  const inner = { kind: "try", statements: [{ kind: "pass" }], catches: [{ statements: [{ kind: "pass" }] }] };
  const outer = { kind: "try", statements: [inner], catches: [], finallyStatements: [{ kind: "pass" }] };
  assert.match(printMojoModule(statementModule([outer])), /        except:\n            pass\n        pass\n    finally:/u);
  const separated = { ...outer, statements: [inner, { kind: "pass" }] };
  assert.equal(printMojoModule(statementModule([outer])), printMojoModule(statementModule([separated])));
});

test("printer keeps scalar literals intact while breaking their enclosing operation", () => {
  const value = { kind: "construct", type: { kind: "source-primitive", name: "float64" },
    arguments: [{ value: { kind: "number-literal", text: "100" } }],
  };
  const expression = { kind: "binary", operator: "+",
    left: { kind: "path", path: "first_meaningful_operand_with_a_long_name" },
    right: { kind: "binary", operator: "*", left: value,
      right: { kind: "path", path: "second_meaningful_operand_with_a_long_name" } },
  };
  const printed = printMojoModule(statementModule([{ kind: "return", expression }]));
  assert.match(printed, /Float64\(100\)/u);
  assert.doesNotMatch(printed, /Float64\(\n/u);
});

test("printer chooses string delimiters without changing escaped characters", () => {
  const examples = [
    ["plain", '"plain"'],
    ['say "hello"', `'say "hello"'`],
    ["it's fine", '"it\'s fine"'],
    ['"\\ud800"', `'"\\\\ud800"'`],
    ['"\\"', `'"\\\\"'`],
    ['"\n"', `'"\\n"'`],
  ];
  for (const [value, literal] of examples) {
    const printed = printMojoModule(statementModule([{ kind: "return", expression: { kind: "string-literal", value } }]));
    assert.ok(printed.includes(`return ${literal}\n`), printed);
  }
});

test("printer preserves branch regions while spelling a single conditional tail as elif", () => {
  const tail = {
    kind: "if", condition: { kind: "path", path: "second" },
    thenStatements: [{ kind: "pass" }], elseStatements: [{ kind: "pass" }],
  };
  const branch = {
    kind: "if", condition: { kind: "path", path: "first" },
    thenStatements: [{ kind: "pass" }], elseStatements: [tail],
  };
  assert.match(printMojoModule(statementModule([branch])), /    elif second:\n        pass\n    else:/u);
  const scoped = { ...branch, elseStatements: [{ kind: "pass" }, tail] };
  assert.match(printMojoModule(statementModule([scoped])), /    else:\n        pass\n        if second:/u);
  const mixed = { ...branch, elseStatements: [{ ...tail, compileTime: true }] };
  assert.match(printMojoModule(statementModule([mixed])), /    else:\n        comptime if second:/u);
});

test("printer groups boolean chains once without reassociating arithmetic or comparisons", () => {
  const path = (name) => ({ kind: "path", path: name });
  const binary = (operator, left, right) => ({ kind: "binary", operator, left, right });
  const chain = ["first_long_condition", "second_long_condition", "third_long_condition", "fourth_long_condition"]
    .map(path).reduce((left, right) => binary("or", left, right));
  assert.match(printMojoModule(statementModule([{ kind: "return", expression: chain }])),
    /return \(\n        first_long_condition\n        or second_long_condition\n        or third_long_condition\n        or fourth_long_condition\n    \)/u);
  const subtraction = binary("-", path("first"), binary("-", path("second"), path("third")));
  assert.match(printMojoModule(statementModule([{ kind: "return", expression: subtraction }])),
    /return first - \(second - third\)/u);
  const comparison = binary("==", binary("<", path("first"), path("second")), path("third"));
  assert.match(printMojoModule(statementModule([{ kind: "return", expression: comparison }])),
    /return \(first < second\) == third/u);
});

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
  assert.throws(() => printMojoModule({ ...module, imports: [] }), /has no selected symbol import/u);
  assert.match(printMojoModule({ ...module, imports: [
    { kind: "module", modulePath: ["tsonic_js"], alias: "js" },
  ] }), /return js\.JsString\("hello"\)/u);
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
