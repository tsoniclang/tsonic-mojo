import assert from "node:assert/strict";
import test from "node:test";
import { borrowedProjection, foreignProvider } from "../../helpers/native-interop-provider.mjs";
import { bindTargetTypePattern } from "../../../dist/policy/operations/provider-bindings.js";
import { resolveMojoAssociatedType } from "../../../dist/providers/compiler/projection/associated-types.js";
import { mojoProviderOriginSourceType } from "../../../dist/providers/compiler/projection/origins.js";
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
