import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo } from "../../helpers/mojo-session.mjs";

const i32 = 'import type { i32 } from "@tsonic/mojo/types.js";';

const cases = Object.freeze([
  Object.freeze({
    lane: "declarations.inheritance",
    expected: Object.freeze(["MOJO_CLASS_HERITAGE_UNSUPPORTED"]),
    source: "class Base {} class Derived extends Base {} export function main(): void {}",
  }),
  Object.freeze({
    lane: "declarations.generic-virtual-methods",
    expected: Object.freeze(["MOJO_CLASS_HERITAGE_UNSUPPORTED"]),
    source: `${i32} class Base { identity<T>(value: T): T { return value; } } class Derived extends Base { override identity<T>(value: T): T { return value; } } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "declarations.open-generic-virtual-callers",
    expected: Object.freeze(["MOJO_CLASS_HERITAGE_UNSUPPORTED"]),
    source: `${i32} class Base { identity<T>(value: T): T { return value; } } class Derived extends Base {} function call<T>(base: Base, value: T): T { return base.identity<T>(value); } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "declarations.interface-properties-methods",
    expected: Object.freeze(["MOJO_INTERFACE_MEMBER_UNSUPPORTED"]),
    source: `${i32} interface Counter { value: i32; increment(): i32; } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "declarations.interface-heritage",
    expected: Object.freeze(["MOJO_INTERFACE_HERITAGE_UNSUPPORTED"]),
    source: `${i32} interface Parent { value: i32; } interface Child extends Parent { other: i32; } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "objects.contextual-method-declarations",
    expected: Object.freeze(["MOJO_TARGET_TYPE_UNSUPPORTED"]),
    source: `${i32} const counter = { value: 1 as i32, next() { return this.value + 1; } }; export function main(): void {}`,
  }),
  Object.freeze({
    lane: "objects.callable-property-values",
    expected: Object.freeze(["MOJO_VALUE_CONVERSION_UNPROVEN"]),
    source: `${i32} interface Counter { value: i32; next: () => i32; } const counter: Counter = { value: 1, next: function () { return this.value + 1; } }; export function main(): void {}`,
  }),
  Object.freeze({
    lane: "objects.method-value-operations",
    expected: Object.freeze(["MOJO_PROPERTY_SELECTION_UNRESOLVED", "MOJO_PROPERTY_SELECTION_UNRESOLVED"]),
    source: `${i32} class Counter { value: i32 = 1; next(): i32 { return this.value; } } function replacement(): i32 { return 2; } export function main(): void { const counter = new Counter(); const next = counter.next; counter.next = replacement; }`,
  }),
  Object.freeze({
    lane: "objects.method-spread",
    expected: Object.freeze(["MOJO_TARGET_TYPE_UNSUPPORTED", "MOJO_TARGET_TYPE_UNSUPPORTED"]),
    source: `${i32} const counter = { value: 1 as i32, next() { return this.value; } }; const derived = { ...counter, value: 2 as i32 }; export function main(): void {}`,
  }),
  Object.freeze({
    lane: "objects.overloaded-method-declarations",
    expected: Object.freeze(["MOJO_INTERFACE_MEMBER_UNSUPPORTED", "MOJO_INTERFACE_MEMBER_UNSUPPORTED"]),
    source: `${i32} interface Parser { parse(value: string): string; parse(value: string, radix: i32): string; } const parser: Parser = { parse(value: string, radix?: i32): string { return value; } }; export function main(): void {}`,
  }),
  Object.freeze({
    lane: "objects.accessor-members",
    expected: Object.freeze(["MOJO_TARGET_TYPE_UNSUPPORTED"]),
    source: `${i32} const value = { get count(): i32 { return 1; } }; export function main(): void {}`,
  }),
  Object.freeze({
    lane: "iteration.sync-async",
    expected: Object.freeze(["MOJO_ASYNC_ITERATION_NATIVE_LIMIT"]),
    source: `${i32} async function consume(values: i32[]): Promise<void> { for await (const value of values) { if (value === 0) return; } } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "generators.bidirectional",
    expected: Object.freeze(["MOJO_GENERATOR_NATIVE_LIMIT"]),
    source: `${i32} function* values(): Generator<i32, string, i32> { const next = yield 1; return "done"; } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "generators.async",
    expected: Object.freeze(["MOJO_GENERATOR_NATIVE_LIMIT"]),
    source: `${i32} async function load(): Promise<i32> { return 1; } async function* values() { yield await load(); } export function main(): void {}`,
  }),
  Object.freeze({
    lane: "generators.resource-suspension",
    expected: Object.freeze(["MOJO_GENERATOR_NATIVE_LIMIT"]),
    source: `${i32} class Resource { value: i32 = 1; [Symbol.dispose](): void {} } function* values() { using resource = new Resource(); yield resource.value; } export function main(): void {}`,
  }),
]);

for (const fixture of cases) {
  test(`${fixture.lane} rejects at its exact Mojo boundary`, () => {
    const result = compileMojo({ files: { "index.ts": fixture.source } });
    assert.equal(result.artifacts.length, 0);
    assert.deepEqual(result.diagnostics.map(({ code }) => code), fixture.expected);
  });
}
