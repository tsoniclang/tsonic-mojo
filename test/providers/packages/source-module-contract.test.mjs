import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../../../dist/public/provider.js";
import { collectMojoSourceModuleConstructions } from "../../../dist/analysis/source-modules/construction.js";

function definition() {
  const exportId = "@fixture/background::Runner";
  const memberId = `${exportId}.constructor`;
  const signatureId = `${memberId}(module)`;
  return {
    id: "@fixture/background", displayName: "Background fixture", version: "1.0.0",
    modules: [{ moduleSpecifier: "@fixture/background", providerModuleId: "fixture.background", exports: [{
      id: exportId, kind: "class", name: "Runner", members: [{
        id: memberId, name: "constructor", kind: "constructor", signatures: [{
          id: signatureId, name: "constructor", parameters: [{ name: "module", type: { kind: "string" } }], returnType: { kind: "void" },
        }],
      }],
    }] }],
    operations: [{ exportId, memberId, signatureId, operationKind: "constructor",
      parameterTypes: [{ kind: "native-string" }], resultType: { kind: "unit" },
      target: { kind: "function-call", modulePath: ["background"], name: "start",
        arguments: [{ convention: "imm", position: "positional-or-keyword" }],
        sourceModule: { parameterIndex: 0, bootstrap: { id: "fixture.entry", modulePath: ["background"], entryName: "entry", completeName: "complete" } },
      },
    }],
    runtimePackages: [{ packageName: "background", packagePath: "/fixture/background" }],
  };
}

test("provider source-module contracts are validated and captured immutably", () => {
  const input = definition();
  const capability = createMojoProviderPackage(input);
  const captured = capability.createTargetContributions({})[0].definition.operations[0].target.sourceModule;
  input.operations[0].target.sourceModule.bootstrap.entryName = "changed";
  assert.equal(captured.bootstrap.entryName, "entry");
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured.bootstrap.modulePath));
});

for (const [name, mutate] of [
  ["negative slot", (operation) => { operation.target.sourceModule.parameterIndex = -1; }],
  ["absent slot", (operation) => { operation.target.sourceModule.parameterIndex = 1; }],
  ["fractional slot", (operation) => { operation.target.sourceModule.parameterIndex = 0.5; }],
  ["non-string slot", (operation) => { operation.parameterTypes[0] = { kind: "unit" }; }],
  ["borrowed slot", (operation) => { operation.target.arguments[0].convention = "mut"; }],
  ["empty bootstrap identity", (operation) => { operation.target.sourceModule.bootstrap.id = ""; }],
  ["invalid probe", (operation) => { operation.target.sourceModule.bootstrap.entryName = "not-a-name"; }],
  ["empty bootstrap module", (operation) => { operation.target.sourceModule.bootstrap.modulePath = []; }],
]) {
  test(`source-module contract rejects ${name}`, () => {
    const input = definition();
    mutate(input.operations[0]);
    assert.throws(() => createMojoProviderPackage(input), /source-module/u);
  });
}

test("sealed source-module index rejects conflicting bootstrap and module identities", () => {
  const sourceFile = {};
  const first = {};
  const second = {};
  const bootstrap = definition().operations[0].target.sourceModule.bootstrap;
  const construction = { sourceFile, argument: {}, parameterIndex: 0, identity: "project.worker", bootstrap };
  const selections = new WeakMap([
    [first, { kind: "provider", sourceModule: construction }],
    [second, { kind: "provider", sourceModule: { ...construction, bootstrap: { ...bootstrap, completeName: "different" } } }],
  ]);
  const modules = { forSourceFile: (selected) => selected === sourceFile ? { modulePath: ["project", "worker"] } : undefined };
  const result = collectMojoSourceModuleConstructions({ calls: [first, second], selections, modules, binaryOutput: true });
  assert.deepEqual(result.issues.map(({ code }) => code), ["MOJO_SOURCE_MODULE_BOOTSTRAP_CONFLICT"]);
  const badModule = collectMojoSourceModuleConstructions({ calls: [first], selections, modules: { forSourceFile: () => ({ modulePath: ["different"] }) }, binaryOutput: true });
  assert.deepEqual(badModule.issues.map(({ code }) => code), ["MOJO_SOURCE_MODULE_OUTPUT_IDENTITY_CONFLICT"]);
  selections.set(second, { kind: "provider", sourceModule: construction });
  const accepted = collectMojoSourceModuleConstructions({ calls: [first, second], selections, modules, binaryOutput: true });
  assert.deepEqual(accepted.issues, []);
  assert.equal(accepted.entries.length, 1);
});
