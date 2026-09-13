import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../../../dist/public/provider.js";

function definition(memberChanges = {}, operationChanges = {}) {
  const memberId = "fixture.constants.member";
  const exportId = "fixture.constants.export";
  return {
    id: "fixture.constants.package",
    displayName: "Static constants",
    version: "1",
    modules: [{
      moduleSpecifier: "fixture:constants",
      providerModuleId: "fixture.constants.module",
      exports: [{
        id: exportId, name: "Constants", kind: "class",
        members: [{
          id: memberId, name: "token", kind: "property",
          static: true, readonly: true, type: { kind: "string" },
          ...memberChanges,
        }],
      }],
    }],
    operations: [{
      exportId, memberId, operationKind: "property",
      target: { kind: "constant", modulePath: ["native_constants"], name: "TOKEN" },
      parameterTypes: [], resultType: { kind: "native-string" },
      ...operationChanges,
    }],
    runtimePackages: [{ packageName: "native_constants", packagePath: "/fixture/constants" }],
  };
}

test("a provider readonly static property retains an exact native constant", () => {
  const result = createMojoProviderPackage(definition()).createTargetContributions({})[0];
  assert.equal(result.definition.operations[0].target.kind, "constant");
  assert.equal(result.definition.operations[0].target.name, "TOKEN");
  assert.equal(result.definition.operations[0].memberId, "fixture.constants.member");
});

test("static constant admission does not accept mutable, instance or argument-bearing members", () => {
  for (const [member, operation] of [
    [{ readonly: false }, {}],
    [{ static: false }, {}],
    [{}, { receiverType: { kind: "native-string" } }],
    [{}, { parameterTypes: [{ kind: "native-string" }] }],
    [{}, { operationKind: "property-set" }],
  ]) {
    assert.throws(() => createMojoProviderPackage(definition(member, operation)), /Provider property/u);
  }
});
