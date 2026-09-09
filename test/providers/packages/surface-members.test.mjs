import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage, mojoNamedTargetType, mojoStringTargetType } from "../../../dist/public/provider.js";

function definition() {
  const owner = "fixture::Clock";
  const receiver = mojoNamedTargetType("fixture.Clock", ["fixture"], "Clock");
  return {
    id: "fixture-clock", displayName: "Clock", version: "1",
    modules: [{ moduleSpecifier: "fixture:clock", providerModuleId: "fixture.clock", exports: [{ id: owner, name: "Clock", kind: "class", members: [] }] }],
    operations: [], runtimePackages: [],
    surfaceMembers: [{
      id: "date", requiredSurfaces: ["js"],
      declarations: [{ exportId: owner, members: [{ id: `${owner}.stamp`, name: "stamp", kind: "property", readonly: true, type: { kind: "string" } }] }],
      operations: [{ exportId: owner, memberId: `${owner}.stamp`, operationKind: "property", target: { kind: "property-read", access: { kind: "member", name: "stamp" }, receiver: "imm" }, receiverType: receiver, resultType: mojoStringTargetType() }],
    }],
  };
}

function contribution(capability, selectedSurfaceIds) {
  return capability.createTargetContributions({ selectedSurfaceIds })[0].definition;
}

function sourceDeclaration(capability, selectedSurfaceIds) {
  const { extensions } = capability.sourceCompilerContributions({ selectedSurfaceIds });
  let provider;
  extensions[0].initialize({ registerSourceDeclarationProvider(value) { provider = value; } });
  const resolution = provider.resolveModule("fixture:clock");
  return provider.getDeclarationModel(resolution).exports[0];
}

test("surface-selected members and relations have one immutable composition on both boundaries", () => {
  const original = definition();
  const capability = createMojoProviderPackage(original);
  original.surfaceMembers[0].declarations[0].members[0].name = "mutated";
  for (const surfaces of [[], ["other"], ["js"], ["js", "other"], []]) {
    const selected = surfaces.includes("js");
    const result = contribution(capability, surfaces);
    assert.equal(result.surfaceMembers, undefined);
    assert.equal(result.operations.length, Number(selected));
    assert.equal(result.modules[0].exports[0].members.length, Number(selected));
    assert.deepEqual(sourceDeclaration(capability, surfaces).members, result.modules[0].exports[0].members);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.modules[0].exports[0].members));
    if (selected) assert.equal(result.modules[0].exports[0].members[0].name, "stamp");
  }
});

test("surface member declarations require all selected surfaces, not one matching name", () => {
  const input = definition();
  input.surfaceMembers[0].requiredSurfaces = ["js", "extra"];
  const capability = createMojoProviderPackage(input);
  assert.equal(contribution(capability, ["js"]).operations.length, 0);
  assert.equal(contribution(capability, ["extra"]).operations.length, 0);
  assert.equal(contribution(capability, ["extra", "js"]).operations.length, 1);
});

test("invalid and conflicting surface member slices fail before compilation", () => {
  const mutations = [
    (value) => { value.surfaceMembers[0].requiredSurfaces = []; },
    (value) => { value.surfaceMembers[0].requiredSurfaces = ["js", "js"]; },
    (value) => { value.surfaceMembers[0].declarations[0].exportId = "missing"; },
    (value) => { value.surfaceMembers[0].operations[0].memberId = "missing"; },
    (value) => { value.surfaceMembers.push({ ...structuredClone(value.surfaceMembers[0]), id: "second", requiredSurfaces: ["other"] }); },
  ];
  for (const mutate of mutations) {
    const value = definition();
    mutate(value);
    assert.throws(() => createMojoProviderPackage(value), /surface|duplicated/u);
  }
});
