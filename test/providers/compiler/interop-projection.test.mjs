import assert from "node:assert/strict";
import test from "node:test";
import { borrowedProjection, foreignProvider } from "../../helpers/native-interop-provider.mjs";
import { bindTargetTypePattern } from "../../../dist/policy/operations/provider-bindings.js";
import { resolveMojoAssociatedType } from "../../../dist/providers/compiler/projection/associated-types.js";
import { mojoProviderOriginSourceType } from "../../../dist/providers/compiler/projection/origins.js";
import { mojoCompilerOriginMutability } from "../../../dist/providers/compiler/projection/origins.js";
import { mojoCompilerSignatureReferences } from "../../../dist/providers/compiler/model/signature-origins.js";
import { mojoProviderSourceResultContract } from "../../../dist/policy/operations/provider-source-result.js";

test("compiler reference projections retain parameter origins and exact source import identities", () => {
  const projection = borrowedProjection();
  const signature = projection.declarationModel.exports.find((item) => item.name === "borrow").signatures[0];
  assert.deepEqual(signature.typeParameters, [{ name: "origin", constraints: [{
    kind: "provider-ref", moduleSpecifier: "@tsonic/mojo/types.js", exportName: "Origin",
  }] }]);
  assert.deepEqual(signature.returnType, { kind: "provider-ref", moduleSpecifier: "@tsonic/mojo/types.js", exportName: "Ref", typeArguments: [
    { kind: "source-primitive", name: "int32" }, { kind: "type-parameter", name: "origin" },
  ] });
  assert.deepEqual(signature.parameters[0].type, signature.returnType);
  assert.deepEqual(projection.operations.find((item) => item.signatureId === signature.id).resultType.origin, { kind: "parameter", name: "origin" });
  const view = projection.types.find((item) => item.exportId.endsWith(":View"));
  assert.deepEqual(view.targetType.genericArguments, [{ kind: "origin", origin: { kind: "parameter", name: "origin" } }]);
});

test("retained provider result contracts reject primitive and reference identity contradictions", () => {
  const source = { kind: "provider-ref", moduleSpecifier: "@tsonic/mojo/types.js", exportName: "Ref",
    typeArguments: [{ kind: "source-primitive", name: "int32" }, { kind: "type-parameter", name: "O" }] };
  const target = { kind: "reference", mutable: false, origin: { kind: "parameter", name: "O" }, value: { kind: "source-primitive", name: "int32" } };
  assert.equal(mojoProviderSourceResultContract(source, target, target), "reference");
  assert.equal(mojoProviderSourceResultContract(source, target, { ...target, origin: { kind: "parameter", name: "different" } }), "conflict");
  for (const changed of [{ ...target, mutable: true }, { ...target, value: { kind: "source-primitive", name: "uint32" } }, target.value]) {
    assert.equal(mojoProviderSourceResultContract(source, changed, target), "conflict");
  }
  assert.equal(mojoProviderSourceResultContract({ ...source, moduleSpecifier: "user:unrelated" }, target, target), "value");
  assert.equal(mojoProviderSourceResultContract({ kind: "type-parameter", name: "T" }, target.value, { kind: "type-parameter", name: "T" }), "exact-value");
});

test("origin constraints and trait receivers retain independent exact native contracts", () => {
  for (const mutable of [true, false]) {
    const projection = borrowedProjection({ mutable, traitReceiver: true });
    const signature = projection.declarationModel.exports.find((item) => item.name === "borrow").signatures[0];
    assert.equal(signature.typeParameters[0].constraints[0].exportName, mutable ? "MutOrigin" : "ImmOrigin");
    assert.equal(signature.returnType.exportName, mutable ? "MutRef" : "Ref");
    const operation = projection.operations.find((item) => item.memberId?.endsWith("method:read"));
    assert.equal(operation.receiverType.kind, "reference");
    assert.equal(operation.receiverType.mutable, mutable);
    assert.deepEqual(operation.receiverType.origin, { kind: "parameter", name: "origin" });
    assert.deepEqual(projection.declarationModel.imports.map((item) => item.moduleSpecifier), ["@tsonic/mojo/types.js"]);
  }
  for (const [expression, mutable] of [["True", true], ["False", false], ["O.mut", undefined]]) {
    assert.equal(mojoCompilerOriginMutability({ name: "O", constraints: [{ kind: "named", name: "Origin",
      path: "/std/origin/Origin", arguments: [{ kind: "value", name: "mut", expression }] }] }), mutable);
  }
  for (const constraint of [
    { kind: "named", name: "MutOrigin", path: "/user/#mutorigin", arguments: [] },
    { kind: "named", name: "Origin", path: "/std/origin/Origin", arguments: [{ kind: "value", name: "mut", expression: "other.mut" }] },
  ]) assert.throws(() => mojoCompilerOriginMutability({ name: "O", constraints: [constraint] }), /no exact supported mutability/u);
});

test("compiler reference signatures distinguish exact elision from absent or contradictory metadata", () => {
  const receiver = { name: "read", async: false, signature: "def read(ref self) -> Int32",
    args: [{ name: "self", type: "Self", convention: "ref" }] };
  assert.equal(mojoCompilerSignatureReferences(receiver, {}).size, 0);
  const ordinary = { name: "read", async: false, signature: "def read(ref value: Int32) -> Int32",
    args: [{ name: "value", type: "Int32", convention: "ref" }] };
  assert.equal(mojoCompilerSignatureReferences(ordinary, {}).size, 0);
  for (const signature of ["def read", "def other(ref self)", "def read(ref value)", "def read(ref self: Int32)", "def read(ref self, extra: Int32)"]) {
    assert.throws(() => mojoCompilerSignatureReferences({ ...receiver, signature }, {}), /reference signature/u);
  }
  assert.throws(() => mojoCompilerSignatureReferences({ ...ordinary, signature: "def read(ref value: UInt32)" }, {}), /reference signature/u);
});

test("provider patterns bind and reconcile origins and native value arguments independently", () => {
  const bindings = { types: new Map(), origins: new Map(), values: new Map(), packs: new Map() };
  const owner = (origin, value) => ({ kind: "target-named", id: "test.View", modulePath: ["test"], name: "View", genericArguments: [
    { kind: "origin", origin }, value,
  ] });
  const pattern = owner({ kind: "parameter", name: "origin" }, { kind: "value-reference", path: ["width"] });
  const actual = owner({ kind: "parameter", name: "caller" }, { kind: "integer", value: "4" });
  assert.equal(bindTargetTypePattern(pattern, actual, bindings), undefined);
  assert.deepEqual(bindings.origins.get("origin"), actual.genericArguments[0].origin);
  assert.deepEqual(bindings.values.get("width"), actual.genericArguments[1]);
  assert.equal(bindTargetTypePattern(pattern, actual, bindings), undefined);
  assert.match(bindTargetTypePattern(pattern, owner({ kind: "static" }, actual.genericArguments[1]), bindings), /contradictory origins/u);
  assert.match(bindTargetTypePattern(pattern, owner(actual.genericArguments[0].origin, { kind: "integer", value: "8" }), bindings), /contradictory arguments/u);
});

test("static source origins are not conflated with elision or unchecked origins", () => {
  const imports = new Map();
  for (const [kind, exportName] of [["static", "StaticOrigin"],
    ["inferred", "InferredOrigin"], ["untracked", "UntrackedOrigin"], ["unsafe", "UnsafeOrigin"]]) {
    assert.equal(mojoProviderOriginSourceType({ kind, mutable: false }, imports).exportName, exportName);
  }
  assert.deepEqual([...imports.get("@tsonic/mojo/types.js")].sort(), ["InferredOrigin", "StaticOrigin", "UnsafeOrigin", "UntrackedOrigin"]);
  assert.throws(() => mojoProviderOriginSourceType({ kind: "provider-expression", tokens: [] }, imports), /no exact source origin/u);
});

test("associated defaults and alias parameters retain lexical ownership and exact Self", () => {
  const alias = { identity: "Owner.Related", name: "Related", category: "type", abstract: false,
    genericParameters: [{ name: "U", kind: "type", defaultArgument: { kind: "type", type: { kind: "type-parameter", name: "T" } } }],
    targetType: { kind: "tuple", elements: [{ kind: "type-parameter", name: "U" }, { kind: "self", memberPath: [], arguments: [] }] } };
  const owner = { kind: "struct", name: "Owner", genericParameters: [{ kind: "type", name: "T" }], aliases: [alias] };
  const selectedOwner = { kind: "named", name: "Owner", path: "/test/Owner", arguments: [{ kind: "type", type: { kind: "named", name: "Int32", arguments: [] } }] };
  const selected = { kind: "associated", owner: selectedOwner, memberPath: ["Related"], arguments: [] };
  const resolve = (selection) => resolveMojoAssociatedType(selection, undefined, new Map([["Owner", owner]]), "/test", new Set()).type;
  assert.deepEqual(resolve(selected).elements, [selectedOwner.arguments[0].type, selectedOwner]);
  const explicit = { kind: "named", name: "String", arguments: [] };
  assert.deepEqual(resolve({ ...selected, arguments: [{ kind: "type", name: "U", type: explicit }] }).elements, [explicit, selectedOwner]);
  alias.genericParameters = [{ kind: "type", name: "T" }];
  alias.targetType = { kind: "type-parameter", name: "T" };
  assert.deepEqual(resolve({ ...selected, arguments: [{ kind: "type", type: explicit }] }), explicit);
});

test("concrete associated aliases substitute exact owner arguments and reject erased or cyclic shapes", () => {
  const alias = { identity: "test.Owner.Element", name: "Element", category: "type", abstract: false, genericParameters: [], targetType: { kind: "type-parameter", name: "T" } };
  const declaration = { kind: "struct", name: "Owner", genericParameters: [{ name: "T", kind: "type" }], aliases: [alias] };
  const declarations = new Map([["Owner", declaration]]);
  const selected = { kind: "associated", owner: { kind: "named", name: "Owner", path: "/test/Owner", arguments: [{ kind: "type", type: { kind: "named", name: "Int32", arguments: [] } }] }, memberPath: ["Element"], arguments: [] };
  assert.deepEqual(resolveMojoAssociatedType(selected, undefined, declarations, "/test", new Set()).type, selected.owner.arguments[0].type);
  assert.throws(() => resolveMojoAssociatedType(selected, undefined, declarations, "/test", new Set([alias.identity])), /cyclic/u);
  assert.throws(() => resolveMojoAssociatedType({ ...selected, owner: { kind: "type-parameter", name: "Open" } }, undefined, declarations, "/test", new Set()), /exact source projection/u);
  assert.throws(() => resolveMojoAssociatedType({ ...selected, memberPath: ["Missing"] }, undefined, declarations, "/test", new Set()), /no exact concrete/u);
  assert.throws(() => resolveMojoAssociatedType({ ...selected, arguments: [{ kind: "type", type: { kind: "type-parameter", name: "X" } }] }, undefined, declarations, "/test", new Set()), /arity/u);
  assert.throws(() => resolveMojoAssociatedType({ ...selected, owner: { ...selected.owner,
    arguments: [{ kind: "value", expression: "1" }] } }, undefined, declarations, "/test", new Set()), /argument category/u);
  alias.targetType = { kind: "named", name: "Nested", arguments: [{ kind: "type", type: { kind: "type-parameter", name: "T" } }] };
  const named = { ...selected, owner: { ...selected.owner, arguments: [{ ...selected.owner.arguments[0], name: "T" }] } };
  assert.deepEqual(resolveMojoAssociatedType(named, undefined, declarations, "/test", new Set()).type.arguments, selected.owner.arguments);
});

test("foreign provider validation rejects ABI mutations instead of guessing an external declaration", () => {
  for (const mutate of [
    (operation) => { operation.target.symbol = "native_probe();"; },
    (operation) => { operation.target.fixedParameterCount = -1; },
    (operation) => { operation.target.fixedParameterCount = 2; },
    (operation) => { operation.parameterTypes[0] = { kind: "native-string" }; },
    (operation) => { operation.resultType = { kind: "native-string" }; },
    (operation) => { operation.target.arguments[1].restPacking = "list"; },
    (operation) => { operation.raises = true; },
  ]) assert.throws(() => foreignProvider((definition) => { mutate(definition.operations[0]); return definition; }), /Foreign call/u);
});
