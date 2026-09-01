import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const resourceClass = [
  "class Resource {",
  "  [Symbol.dispose](): void {}",
  "}",
].join("\n");

test("using seals lexical cleanup and reverse acquisition order", () => {
  const result = compileMojo({ files: { "index.ts": [
    resourceClass,
    "function run(): void {",
    "  using first = new Resource();",
    "  using second = new Resource();",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def run"));
  assert.ok(source);
  assert.match(source.text, /var first: Resource = Resource\(\)[\s\S]*try:[\s\S]*var second: Resource = Resource\(\)[\s\S]*try:/u);
  assert.equal(source.text.indexOf("second.dispose()") < source.text.indexOf("first.dispose()"), true);
});

test("standalone lexical blocks preserve their resource boundary", () => {
  const result = compileMojo({ files: { "index.ts": [
    resourceClass,
    "function run(): void {",
    "  { using resource = new Resource(); }",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def run"));
  assert.ok(source);
  assert.match(source.text, /var resource: Resource = Resource\(\)[\s\S]*try:[\s\S]*finally:[\s\S]*resource\.dispose\(\)/u);
});

test("using preserves abrupt completion and composes disposal failures", () => {
  const result = compileMojo({ files: { "index.ts": [
    "class FailingResource {",
    "  [Symbol.dispose](): void { throw \"dispose\"; }",
    "}",
    "function run(): void {",
    "  using resource = new FailingResource();",
    "  throw \"body\";",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def run"));
  assert.ok(source);
  assert.match(source.text, /try:[\s\S]*raise "body"[\s\S]*finally:/u);
  assert.match(source.text, /tsonic_runtime\.suppressed_error/u);
});

test("await using selects async disposal while accepting exact sync fallback", () => {
  const result = compileMojo({ files: { "index.ts": [
    resourceClass,
    "class AsyncResource {",
    "  async [Symbol.asyncDispose](): Promise<void> {}",
    "}",
    "async function run(): Promise<void> {",
    "  await using first = new Resource();",
    "  await using second = new AsyncResource();",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("async def run"));
  assert.ok(source);
  assert.match(source.text, /first\.dispose\(\)/u);
  assert.match(source.text, /await tsonic_runtime\.create_task\(second\.disposeAsync\(\)\)/u);
});

test("resource unions and nullish resources dispatch exact selected alternatives", () => {
  const result = compileMojo({ files: { "index.ts": [
    "class First { [Symbol.dispose](): void {} }",
    "class Second { [Symbol.dispose](): void {} }",
    "function run(resource: First | Second | null | undefined): void {",
    "  using active = resource;",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def run"));
  assert.ok(source);
  assert.match(source.text, /if active\.isa\[First\]\(\):/u);
  assert.match(source.text, /\.isa\[First\]\(\)/u);
  assert.match(source.text, /\[First\]\.dispose\(\)/u);
  assert.match(source.text, /\[Second\]\.dispose\(\)/u);
});

test("using in loop initializers and bindings has the exact lexical lifetime", () => {
  const result = compileMojo({ files: { "index.ts": [
    resourceClass,
    "function run(resources: Resource[]): void {",
    "  for (using outer = new Resource(); false;) {}",
    "  for (using current of resources) {}",
    "}",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def run"));
  assert.ok(source);
  assert.match(source.text, /var outer: Resource[\s\S]*try:[\s\S]*while True:[\s\S]*finally:[\s\S]*outer\.dispose\(\)/u);
  assert.match(source.text, /for current in resources:[\s\S]*try:[\s\S]*finally:[\s\S]*current\.dispose\(\)/u);
});

test("top-level using closes before module initialization commits", () => {
  const result = compileMojo({ files: { "index.ts": [
    resourceClass,
    "using resource = new Resource();",
    "export const observed = resource;",
    "export function main(): void {}",
  ].join("\n") } });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("createTsonicModuleState"));
  assert.ok(source);
  assert.match(source.text, /\.resource = Optional\[Resource\]\(Resource\(\)\)[\s\S]*try:/u);
  assert.equal(source.text.indexOf("resource.value().dispose()") < source.text.indexOf("lifecycleInitialized = True"), true);
});

test("missing selected disposal fails at analysis without planner recovery", () => {
  const result = compileMojo({ files: { "index.ts": [
    "function run(value: any): void { using resource = value; }",
    "export function main(): void {}",
  ].join("\n") } });
  assert.equal(result.artifacts.length, 0);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_RESOURCE_DISPOSAL_NOT_SELECTED"));
});
