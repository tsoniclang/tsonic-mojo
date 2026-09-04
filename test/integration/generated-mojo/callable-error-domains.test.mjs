import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("higher-order calls retain one closed typed-error ABI", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class FirstFailure {",
        "  message: string;",
        "  constructor(message: string) { this.message = message; }",
        "}",
        "class SecondFailure {",
        "  code: number;",
        "  constructor(code: number) { this.code = code; }",
        "}",
        "function capture(operation: () => void): string {",
        "  try { operation(); }",
        "  catch (error) {",
        "    if (error instanceof FirstFailure) return error.message;",
        "    if (error instanceof SecondFailure) return `${error.code}`;",
        "    throw error;",
        "  }",
        "  return '';",
        "}",
        "function failFirst(): never { throw new FirstFailure('first'); }",
        "function failSecond(): never { throw new SecondFailure(2); }",
        "function failSource(): never { throw new Error('source'); }",
        "export function main(): void {",
        "  capture(failFirst);",
        "  capture(() => { throw new SecondFailure(3); });",
        "  capture(failSecond);",
        "  capture(failSource);",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def capture"));
  assert.ok(generated);
  assert.match(generated.text, /RaisingCallable\[/u);
  assert.match(
    generated.text,
    /Variant\[[\s\S]*Error,[\s\S]*FirstFailure,[\s\S]*SecondFailure,[\s\S]*TsError,[\s\S]*\]/u,
  );
  assert.match(generated.text, /\.isa\[FirstFailure\]/u);
  assert.match(generated.text, /\.isa\[SecondFailure\]/u);
  assert.doesNotMatch(generated.text, /erase_callable_error/u);
});

test("bottom-return callables adapt to ordinary callback results", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class Failure {",
        "  message: string;",
        "  constructor(message: string) { this.message = message; }",
        "}",
        "function invoke(operation: () => void): void { operation(); }",
        "function fail(): never { throw new Failure('failed'); }",
        "export function main(): void {",
        "  invoke(fail);",
        "  invoke(() => { throw new Failure('inline'); });",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def invoke"));
  assert.ok(generated);
  assert.match(generated.text, /adapt_raising_callable_never_result/u);
  assert.match(generated.text, /RaisingCallable/u);
});

test("callable declarations replace provisional effects with finalized conversions", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class Failure {",
        "  message: string;",
        "  constructor(message: string) { this.message = message; }",
        "}",
        "function fail(): void { throw new Failure('failed'); }",
        "const operation = (): void => { fail(); };",
        "export function main(): void { operation(); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(generated);
  assert.match(generated.text, /def operation\(\) raises Failure:/u);
  assert.match(generated.text, /def tsonic_main\(\) raises Failure:\s+operation\(\)/u);
  assert.doesNotMatch(generated.text, /RaisingCallable|allocate_callable_environment/u);
});

test("stored callable declarations retain their exact error domain", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class FirstFailure {",
        "  message: string;",
        "  constructor(message: string) { this.message = message; }",
        "}",
        "class SecondFailure {",
        "  code: number;",
        "  constructor(code: number) { this.code = code; }",
        "}",
        "export const failFirst = (): never => { throw new FirstFailure('first'); };",
        "function failSecond(): never { throw new SecondFailure(2); }",
        "function invoke(): void { failFirst(); }",
        "export function retainSecondDomain(): void { failSecond(); }",
        "export function main(): void { invoke(); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def invoke"));
  assert.ok(generated);
  assert.match(generated.text, /def fail_first\(\) raises FirstFailure -> Never/u);
  assert.match(generated.text, /def invoke\(\) raises FirstFailure/u);
  assert.match(generated.text, /def tsonic_main\(\) raises FirstFailure:\s+invoke\(\)/u);
  assert.doesNotMatch(generated.text, /def invoke\(\)[^{\n]*SecondFailure/u);
});

test("closed catch domains stringify every retained error member", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "class Failure {",
        "  message: string;",
        "  constructor(message: string) { this.message = message; }",
        "}",
        "function invoke(operation: () => void): string {",
        "  try { operation(); }",
        "  catch (error) { return `failed: ${error}`; }",
        "  return '';",
        "}",
        "export function main(): void {",
        "  invoke(() => { throw new Failure('project'); });",
        "  invoke(() => { throw new Error('source'); });",
        "}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const generated = artifactTexts(result).find(({ text }) => text.includes("def invoke"));
  assert.ok(generated);
  assert.match(generated.text, /\.isa\[Failure\]/u);
  assert.match(generated.text, /error\[TsError\]/u);
  assert.match(generated.text, /String\(/u);
});
