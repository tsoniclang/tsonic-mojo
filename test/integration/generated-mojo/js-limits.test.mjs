import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo } from "../../helpers/mojo-session.mjs";

function compileBody(body) {
  return compileMojo({
    surfaces: ["js"],
    files: {
      "index.ts": `export function main(): void {\n${body}\n}`,
    },
  });
}

function assertTargetRejection(result, code) {
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [code]);
}

test("RegExp-dependent JavaScript operations reject at the exact carrier boundary", () => {
  for (const body of [
    "  /a+/.test('aaa');",
    "  'aaa'.search(/a+/);",
    "  'aaa'.match(/a+/);",
    "  'aaa'.matchAll(/a+/g);",
  ]) {
    assertTargetRejection(
      compileBody(body),
      "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED",
    );
  }
});

test("unsupported JavaScript semantic families have one deterministic boundary", () => {
  assertTargetRejection(
    compileBody("  Object.assign({ value: 1 }, { other: 2 });"),
    "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED",
  );
  assertTargetRejection(
    compileBody("  new Boolean(true);"),
    "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED",
  );
  assertTargetRejection(
    compileBody("  'value'.normalize('NFC');"),
    "MOJO_SOURCE_PROFILE_CALL_UNSUPPORTED",
  );
  assertTargetRejection(
    compileBody("  console.log({ value: 1 });"),
    "MOJO_CALL_ARGUMENT_CARRIER_NOT_CLOSED",
  );
});

test("unavailable locale and reflection declarations fail during source checking", () => {
  assert.throws(
    () => compileBody("  'a'.localeCompare('b');"),
    /TS2339/u,
  );
  assert.throws(
    () => compileBody("  eval('1 + 1');"),
    /TS2304/u,
  );
});
