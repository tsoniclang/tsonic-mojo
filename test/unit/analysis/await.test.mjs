import assert from "node:assert/strict";
import test from "node:test";
import { mojoAwaitOperandIssue } from "../../../dist/analysis/expressions/await.js";

test("await analysis admits exact native coroutine effects without erasing them", () => {
  const output = Object.freeze({ kind: "source-primitive", name: "int32" });
  for (const raises of [false, true]) {
    const type = Object.freeze({ kind: "future", domain: "native", output, raises });
    assert.equal(mojoAwaitOperandIssue(type), undefined);
    assert.equal(type.output, output);
    assert.equal(type.raises, raises);
  }
});

test("await analysis rejects absent or nonfuture evidence instead of selecting a task", () => {
  for (const type of [undefined, { kind: "native-string" }, { kind: "unit" }]) {
    assert.equal(mojoAwaitOperandIssue(type)?.code, "MOJO_AWAIT_OPERAND_NOT_CLOSED");
  }
  assert.equal(mojoAwaitOperandIssue({
    kind: "future", domain: "js", raises: false, output: { kind: "unit" },
  })?.code, "MOJO_JS_PROMISE_AWAIT_RUNTIME_MISSING");
});
