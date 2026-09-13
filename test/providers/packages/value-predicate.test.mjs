import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../../../dist/public/provider.js";
import { selectMojoValuePredicate } from "../../../dist/policy/operations/value-predicate.js";

const carrier = { kind: "target-named", id: "fixture.payload", modulePath: ["fixture"], name: "Payload" };
const predicate = { acceptedType: carrier, boxed: { modulePath: ["fixture"], name: "is_payload" } };

function definition() {
  return {
    id: "fixture.predicates", displayName: "Predicates", version: "1",
    modules: [{ moduleSpecifier: "fixture:predicates", providerModuleId: "fixture.predicates", exports: [{
      id: "fixture.test", name: "recognize", kind: "function", signatures: [{
        id: "fixture.test(value)", name: "recognize", parameters: [{ name: "value", type: { kind: "any" } }],
        returnType: { kind: "boolean" },
      }],
    }] }],
    operations: [{
      exportId: "fixture.test", signatureId: "fixture.test(value)", operationKind: "call",
      target: { kind: "value-predicate", predicate: structuredClone(predicate), genericParameters: [],
        arguments: [{ convention: "imm", position: "positional-or-keyword" }] },
      parameterTypes: [{ kind: "dynamic", domain: "js" }], resultType: { kind: "source-primitive", name: "bool" },
    }],
    runtimePackages: [{ packageName: "fixture", packagePath: "/fixture" }],
  };
}

test("native predicates are exact immutable provider contracts, independent of member spelling", () => {
  const input = definition();
  const captured = createMojoProviderPackage(input).createTargetContributions({})[0].definition.operations[0].target.predicate;
  input.operations[0].target.predicate.boxed.name = "changed";
  assert.equal(captured.boxed.name, "is_payload");
  assert.ok(Object.isFrozen(captured));
  assert.deepEqual(selectMojoValuePredicate(carrier, captured), { kind: "constant", value: true });
  assert.deepEqual(selectMojoValuePredicate({ ...carrier, id: "unrelated.payload" }, captured), { kind: "constant", value: false });
  const selected = selectMojoValuePredicate({ kind: "optional", value: { kind: "union", members: [carrier, { kind: "native-string" }] } }, captured);
  assert.equal(selected.kind, "optional");
  assert.deepEqual(selected.present.members.map(({ selection }) => selection.value), [true, false]);
  assert.equal(selectMojoValuePredicate({ kind: "dynamic", domain: "js" }, captured).kind, "boxed");
  assert.equal(selectMojoValuePredicate({ kind: "type-parameter", name: "Open" }, captured), undefined);
});

test("malformed predicate contracts fail at provider validation", () => {
  for (const mutate of [
    (row) => { row.target.arguments = []; },
    (row) => { row.target.arguments[0].convention = "mut"; },
    (row) => { row.target.arguments[0].variadic = true; },
    (row) => { row.resultType = { kind: "native-string" }; },
    (row) => { row.raises = true; },
    (row) => { row.receiverType = carrier; },
    (row) => { row.target.predicate.acceptedType = { kind: "dynamic", domain: "js" }; },
    (row) => { row.target.predicate.acceptedType.genericArguments = [{ kind: "type", type: { kind: "type-parameter", name: "Open" } }]; },
    (row) => { row.target.predicate.boxed.modulePath = []; },
    (row) => { row.target.predicate.boxed.name = "guessed()"; },
  ]) {
    const input = definition();
    mutate(input.operations[0]);
    assert.throws(() => createMojoProviderPackage(input), /predicate/u);
  }
});
