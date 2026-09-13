import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { formatMojoCompileOutput, MojoFormattingError } from "../../../dist/backend/emission/mojo-format.js";
import { compileMojo } from "../../helpers/mojo-session.mjs";

const command = Object.freeze({ executable: "mojo", arguments: Object.freeze([]), workingDirectory: process.cwd() });
const version = "1.1.0.dev2026083005";
const fakeCompiler = fileURLToPath(new URL("../../fixtures/formatter/failure.mjs", import.meta.url));
const source = (path, text = "def value()->Int:\n    return 42\n") => Object.freeze({ kind: "source", language: "mojo", path, text });
const output = (artifacts) => Object.freeze({ artifacts: Object.freeze(artifacts) });

test("native Mojo formatting is canonical, deterministic and immutable", () => {
  const manifest = Object.freeze({ kind: "project", path: "pixi.toml", text: "[workspace]\nname = 'proof'\n" });
  const original = output([manifest, source("src/value.mojo")]);
  const formatted = formatMojoCompileOutput(original, command, version);
  assert.equal(formatted.artifacts[0], manifest);
  assert.equal(formatted.artifacts[1].text, "def value() -> Int:\n    return 42\n");
  assert.equal(original.artifacts[1].text, "def value()->Int:\n    return 42\n");
  assert.deepEqual(formatMojoCompileOutput(original, command, version), formatted);
  assert.deepEqual(formatMojoCompileOutput(formatted, command, version), formatted);
  assert.ok(Object.isFrozen(formatted) && Object.isFrozen(formatted.artifacts[1]));
});

test("native Mojo formatter handles nested continuations and long Unicode strings", () => {
  const diagnostic = 'A long diagnostic with spaces, "quotes", a backslash \\ and Unicode 😀 that requires canonical continuation layout';
  const text = [
    "def describe(first_condition: Bool, second_condition: Bool) -> String:",
    "    if not ((first_condition and second_condition)):",
    `        return ${JSON.stringify(diagnostic)}`,
    '    return "first" if first_condition else "second" if second_condition else "last"',
    "",
  ].join("\n");
  const original = output([source("src/descriptions.mojo", text)]);
  const formatted = formatMojoCompileOutput(original, command, version);
  assert.deepEqual(formatMojoCompileOutput(formatted, command, version), formatted);
  assert.equal(original.artifacts[0].text, text);
  assert.match(formatted.artifacts[0].text, /Unicode 😀/u);
});

test("formatter batches preserve all artifact identities and order", () => {
  const artifacts = Array.from({ length: 129 }, (_, index) => source(`src/value_${index}.mojo`));
  const original = output(artifacts);
  const formatted = formatMojoCompileOutput(original, command, version);
  assert.deepEqual(formatted.artifacts.map(({ path }) => path), artifacts.map(({ path }) => path));
  for (const artifact of formatted.artifacts) assert.equal(artifact.text, "def value() -> Int:\n    return 42\n");
});

test("formatter treats dash-prefixed artifact paths as file operands", () => {
  const formatted = formatMojoCompileOutput(output([source("-value.mojo")]), command, version);
  assert.equal(formatted.artifacts[0].path, "-value.mojo");
  assert.match(formatted.artifacts[0].text, /def value\(\) -> Int:/u);
});

test("formatter rejects unsafe and conflicting artifact paths before execution", () => {
  const missing = { ...command, executable: "/no-such-mojo-formatter" };
  for (const paths of [
    ["/absolute.mojo"], ["../outside.mojo"], ["dir/../../outside.mojo"], ["bad\0.mojo"],
    ["dir\\file.mojo"], ["file.txt"], ["same.mojo", "same.mojo"],
    ["same.mojo", "dir/../same.mojo"], ["parent.mojo", "parent.mojo/child.mojo"],
  ]) {
    assert.throws(() => formatMojoCompileOutput(output(paths.map((path) => source(path))), missing, version),
      (error) => error instanceof MojoFormattingError && !error.message.includes("Unable to execute"));
  }
});

test("formatter does not run when there are no generated Mojo sources", () => {
  const original = output([{ kind: "asset", path: "native.c", text: "int value;\n" }]);
  assert.equal(formatMojoCompileOutput(original, { ...command, executable: "/missing-mojo" }, version), original);
});

test("missing compiler, wrong version and invalid native syntax reject precisely", () => {
  assert.throws(() => formatMojoCompileOutput(output([source("value.mojo")]),
    { ...command, executable: "/missing-mojo-formatter" }, version), /Unable to execute Mojo formatter/u);
  assert.throws(() => formatMojoCompileOutput(output([source("value.mojo")]), command, "0.0.invalid"), /does not match required/u);
  assert.throws(() => formatMojoCompileOutput(output([source("value.mojo", "def broken(\n")]), command, version),
    (error) => error instanceof MojoFormattingError && /exited with status/u.test(error.message) &&
      error.message.includes("<mojo-format-stage>") && !error.message.includes("/tmp/tsonic-mojo-format-"));
});

test("later formatter batch failure cannot expose partially formatted output", () => {
  const root = mkdtempSync(join(tmpdir(), "mojo-format-late-proof-"));
  try {
    const record = join(root, "calls.jsonl");
    const configured = { executable: process.execPath, arguments: [fakeCompiler, "late", record], workingDirectory: root };
    const original = output(Array.from({ length: 129 }, (_, index) => source(`src/value_${index}.mojo`)));
    assert.throws(() => formatMojoCompileOutput(original, configured, version), /exited with status 42/u);
    const calls = readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(calls.map(({ files }) => files), [128, 1]);
    for (const artifact of original.artifacts) assert.equal(artifact.text, "def value()->Int:\n    return 42\n");
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("signal, output overflow and missing formatter result reject without publication", () => {
  for (const mode of ["signal", "overflow", "missing"]) {
    const original = output([source("value.mojo")]);
    const configured = { executable: process.execPath, arguments: [fakeCompiler, mode], workingDirectory: process.cwd() };
    assert.throws(() => formatMojoCompileOutput(original, configured, version),
      (error) => error instanceof MojoFormattingError && error.message.length <= 16 * 1024);
    assert.equal(original.artifacts[0].text, "def value()->Int:\n    return 42\n");
  }
});

test("full target compilation reports a formatter diagnostic and no artifacts", () => {
  const result = compileMojo({
    files: { "index.ts": "export function value(): number { return 42; }" },
    target: { id: "mojo", options: { outputType: "lib", compiler: {
      executable: "/missing-mojo-formatter", workingDirectory: process.cwd(),
    } } },
  });
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), ["MOJO_SOURCE_FORMATTING_FAILED"]);
});
