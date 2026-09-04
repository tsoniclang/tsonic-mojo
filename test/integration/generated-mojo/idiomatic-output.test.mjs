import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

test("ordinary declarations use native names, immutable parameters, and no module state", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { int32 } from "@tsonic/core/types.js";',
        "export function addValues(left: int32, right: int32): int32 {",
        "  return left + right;",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def add_values"));
  assert.ok(source);
  assert.match(source.text, /def add_values\(left: Int32, right: Int32\) -> Int32:/u);
  assert.match(source.text, /return left \+ right/u);
  assert.doesNotMatch(source.text, /GlobalCell|ModuleState|module_state/u);
});

test("a unique authored complex alias remains the module ABI name", () => {
  const result = compileMojo({
    files: {
      "values.ts": [
        "export class Success { value: string = \"ok\"; }",
        "export class Failure { message: string = \"failed\"; }",
        "export type Outcome = Success | Failure;",
      ].join("\n"),
      "index.ts": [
        'import type { Outcome } from "./values.js";',
        "export function identityOutcome(value: Outcome): Outcome { return value; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const values = artifactTexts(result).find(({ path }) => path.endsWith("values.mojo"));
  const entry = artifactTexts(result).find(({ text }) => text.includes("def identity_outcome"));
  assert.ok(values);
  assert.ok(entry);
  assert.match(values.text, /comptime Outcome = Variant\[Failure, Success\]/u);
  assert.doesNotMatch(values.text, /from tsonic_generated\.values import/u);
  assert.match(entry.text, /from .*values import Outcome/u);
  assert.match(entry.text, /def identity_outcome\(value: Outcome\) -> Outcome:/u);
});

test("generic authored aliases retain exact applications", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "type Quad<T> = [T, T, T, T];",
        "function preserve<T>(value: Quad<T>): Quad<T> { return value; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("comptime Quad"));
  assert.ok(source);
  assert.match(source.text, /comptime Quad\[T: Movable & Deinitable\] = Tuple\[T, T, T, T\]/u);
  assert.match(source.text, /def preserve\[T: Movable & Deinitable\]\(value: Quad\[T\]\) -> Quad\[T\]:/u);
});

test("structurally equal scalar aliases are not guessed at unrelated uses", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "type UserId = string;",
        "type Email = string;",
        "function echo(value: string): string { return value; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("comptime UserId"));
  assert.ok(source);
  assert.match(source.text, /comptime UserId = String/u);
  assert.match(source.text, /comptime Email = String/u);
  assert.match(source.text, /def echo\(value: String\) -> String:/u);
  assert.doesNotMatch(source.text, /def echo\(value: (?:UserId|Email)\)/u);
});

test("private source members receive native private Mojo names", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { int32 } from "@tsonic/core/types.js";',
        "class Counter {",
        "  private currentValue: int32 = 1;",
        "  private readValue(): int32 { return this.currentValue; }",
        "  value(): int32 { return this.readValue(); }",
        "}",
        "export function main(): void { new Counter().value(); }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("struct Counter"));
  assert.ok(source);
  assert.match(source.text, /var _current_value: Int32/u);
  assert.match(source.text, /def _read_value\(/u);
  assert.doesNotMatch(source.text, /currentValue|readValue/u);
});

test("explicit moves of trivial register values emit no meaningless transfer", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import { move } from "@tsonic/core/lang.js";',
        'import type { int32 } from "@tsonic/core/types.js";',
        "function pass(value: int32): int32 { return move(value); }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def pass"));
  assert.ok(source);
  assert.match(source.text, /return value/u);
  assert.doesNotMatch(source.text, /return \(?value\^/u);
});

test("ordinary generic returns require exactly implicit-copyable inputs", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "function identity<T>(value: T): T { return value; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def identity"));
  assert.ok(source);
  assert.match(source.text, /def identity\[T: ImplicitlyCopyable & Deinitable\]\(value: T\) -> T:/u);
  assert.match(source.text, /return value/u);
  assert.doesNotMatch(source.text, /var value|value\^/u);
});

test("unused generic inputs retain the weaker movable lifecycle", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        "function ignore<T>(_value: T): void {}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def ignore"));
  assert.ok(source);
  assert.match(source.text, /def ignore\[T: Movable & Deinitable\]\(_value: T\):/u);
  assert.doesNotMatch(source.text, /ImplicitlyCopyable/u);
});

test("project generic fields retain their exact physical carrier", () => {
  const result = compileMojo({
    files: {
      "index.ts": [
        'import type { i32 } from "@tsonic/mojo/types.js";',
        "interface Pair<T> { left: T; right: T; }",
        "function first(pair: Pair<i32>): i32 { return pair.left; }",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def first"));
  assert.ok(source);
  assert.match(source.text, /def first\(pair: Pair\[Int32\]\) -> Int32:/u);
  assert.match(source.text, /return pair\._state\[\]\.left/u);
  assert.doesNotMatch(source.text, /return Int32\(/u);
});

test("module initializers use collision-safe imports and one local state reference", () => {
  const result = compileMojo({
    files: {
      "settings.ts": [
        'import type { int32 } from "@tsonic/core/types.js";',
        "let calls: int32 = 0;",
        "export function load(): int32 { calls += 1; return 41; }",
      ].join("\n"),
      "index.ts": [
        'import { load } from "./settings.js";',
        "const selected = load();",
        "export function main(): void { if (selected !== 41) return; }",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const sources = artifactTexts(result);
  const settings = sources.find(({ path }) => path.endsWith("settings.mojo"));
  const entry = sources.find(({ text }) => text.includes("settings_initialize_module"));
  assert.ok(settings);
  assert.ok(entry);
  assert.match(
    entry.text,
    /from .*settings import[\s\S]*_initialize_module as settings_initialize_module/u,
  );
  assert.match(entry.text, /def _initialize_module\(\):[\s\S]*settings_initialize_module\(\)/u);
  assert.doesNotMatch(entry.text, /def _initialize_module\(\):\n\s+_initialize_module\(\)/u);
  assert.match(settings.text, /var _state = _module_state\.get\(\)/u);
  assert.match(settings.text, /_state\[\]\.calls = Optional\[Int32\]/u);
  assert.equal((settings.text.match(/_module_state\.get\(\)/gu) ?? []).length, 3);
  assert.match(settings.text, /def _initialize_module_body\(\):\s+var _state = _module_state\.get\(\)/u);
  assert.match(settings.text, /def _initialize_module\(\):\s+var _state_2 = _module_state\.get\(\)/u);
  assert.match(settings.text, /def load\(\) -> Int32:\s+_module_state\.get\(\)/u);
});
