import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const declarations = [
  "class FirstFailure { value: number = 1; }",
  "class SecondFailure { value: number = 2; }",
  "class ArgumentFailure { value: number = 3; }",
  "function selected(value: number): number {",
  "  if (value === 1) throw new FirstFailure();",
  "  if (value === 2) throw new SecondFailure();",
  "  return value;",
  "}",
  "function argument(value: number): number {",
  "  if (value === 3) throw new ArgumentFailure();",
  "  if (value < 0) return selected(-value);",
  "  return value;",
  "}",
  "class Selected {",
  "  value: number;",
  "  constructor(value: number) { this.value = selected(value); }",
  "  run(value: number): number { return selected(value); }",
  "  static run(value: number): number { return selected(value); }",
  "}",
];

for (const [shape, expression] of [
  ["function", "selected(argument(value))"],
  ["static method", "Selected.run(argument(value))"],
  ["instance method", "receiver.run(argument(value))"],
  ["constructor", "new Selected(argument(value)).value"],
  ["native callable", "operation(argument(value))"],
]) {
  test(`${shape} widens its own union separately from argument errors`, () => {
    const result = compileMojo({ files: { "index.ts": [
      ...declarations,
      "export function invoke(value: number): number {",
      ...(shape === "instance method" ? ["const receiver = new Selected(0);"] : []),
      ...(shape === "native callable" ? ["const operation = selected;"] : []),
      `return ${expression};`,
      "}",
      "export function main(): void { invoke(0); }",
    ].join("\n") } });
    assert.deepEqual(result.diagnostics, []);
    const generated = artifactTexts(result).find(({ text }) => text.includes("def invoke("));
    assert.ok(generated);
    const body = generated.text.split("def invoke(")[1].split("\ndef ")[0];
    const evaluatedArgument = body.indexOf("= argument(value)");
    assert.ok(evaluatedArgument >= 0, body);
    assert.match(body, /unsafe_unwrap\[FirstFailure\]\(\)/u);
    assert.match(body, /unsafe_unwrap\[SecondFailure\]\(\)/u);
    assert.doesNotMatch(body, /unsafe_unwrap\[ArgumentFailure\]\(\)/u);
    assert.ok(body.indexOf("try:", evaluatedArgument) > evaluatedArgument, body);
    assert.equal(body.match(/argument\(value\)/gu)?.length, 1);
  });
}

test("equal invocation and operand error domains retain direct nested calls", () => {
  const result = compileMojo({ files: { "index.ts": [
    ...declarations,
    "export function invoke(value: number): number { return selected(selected(value)); }",
    "export function main(): void { invoke(0); }",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def invoke("));
  assert.ok(generated);
  const body = generated.text.split("def invoke(")[1].split("\ndef ")[0];
  assert.match(body, /return selected\(selected\(value\)\)/u);
  assert.doesNotMatch(body, /try:|except |var _call_argument/u);
});

test("re-exported first-class function storage participates in library initialization closure", () => {
  const result = compileMojo({
    target: { id: "mojo", options: { outputType: "lib" } },
    files: {
      "index.ts": "export { invoke } from './worker.js';",
      "worker.ts": [
        ...declarations,
        "export function invoke(value: number): number {",
        "  const operation = selected;",
        "  return operation(argument(value));",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = artifactTexts(result);
  const facade = sources.find(({ text }) => text.includes("def _initialize_tsonic_package("));
  const owner = sources.find(({ text }) => text.includes("def invoke("));
  assert.ok(facade, "Library facade must expose the required module-initialization contract.");
  assert.ok(owner);
  assert.match(facade.text, /_initialize_module|_initialize_tsonic_module/u);
  assert.match(owner.text, /def _initialize_module\(\)/u);
});
