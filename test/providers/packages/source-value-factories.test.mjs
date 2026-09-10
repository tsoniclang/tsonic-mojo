import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../../../dist/public/provider.js";
import { createMojoProviderSourceValueIndex } from "../../../dist/providers/packages/source-values.js";

const carrier = Object.freeze({ kind: "target-named", id: "fixture.native.Record", modulePath: ["fixture"], name: "Record" });
const factory = Object.freeze({ modulePath: ["fixture", "values"], name: "retain_record" });

function definition(sourceValueFactory = factory) {
  return {
    id: "fixture.values", displayName: "Exact source values", version: "1",
    modules: [{ moduleSpecifier: "fixture:values", providerModuleId: "fixture.source.values",
      exports: [{ id: "fixture:values::Record", name: "Record", kind: "class", members: [] }] }],
    types: [{ exportId: "fixture:values::Record", sourceGenericParameters: [], targetType: carrier, sourceValueFactory }],
    operations: [], runtimePackages: [{ packageName: "fixture", packagePath: "/fixture" }],
  };
}

test("provider source-value factories are immutable producer identities", () => {
  const input = definition({ modulePath: ["fixture", "values"], name: "retain_record" });
  const capability = createMojoProviderPackage(input);
  input.types[0].sourceValueFactory.modulePath[0] = "changed";
  input.types[0].sourceValueFactory.name = "changed";
  const result = capability.createTargetContributions({})[0].definition.types[0].sourceValueFactory;
  assert.deepEqual(result, factory);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.modulePath));
});

test("source-value factory lookup neither infers names nor accepts contradictory aliases", () => {
  const row = definition().types[0];
  const index = createMojoProviderSourceValueIndex([row, { ...row, exportId: "fixture:alias::Record" }]);
  assert.deepEqual(index.factoryForType(carrier), factory);
  assert.equal(index.factoryForType({ ...carrier, id: "unrelated.Record" }), undefined);
  assert.equal(index.factoryForType({ ...carrier, modulePath: ["other"] }), undefined);
  assert.equal(index.factoryForType({ ...carrier, genericArguments: [{ kind: "type", type: { kind: "native-string" } }] }), undefined);
  assert.throws(() => createMojoProviderSourceValueIndex([
    row, { ...row, sourceValueFactory: { ...factory, name: "another_record" } },
  ]), /conflicting source-value factories/u);
  assert.throws(() => createMojoProviderSourceValueIndex([
    row, { ...row, sourceValueFactory: { ...factory, modulePath: ["other"] } },
  ]), /conflicting source-value factories/u);
});

test("unclosed provider factories cannot introduce syntax, effects or alternate selection", () => {
  for (const invalid of [
    { modulePath: [], name: "retain" }, { modulePath: ["fixture/values"], name: "retain" },
    { modulePath: ["fixture"], name: "retain()" }, { modulePath: ["fixture"], name: "retain", raises: true },
    { modulePath: ["fixture"], name: "retain", fallback: "other" },
  ]) {
    assert.throws(() => createMojoProviderPackage(definition(invalid)), /invalid closed source-value factory/u);
  }
  const generic = definition();
  generic.types[0].sourceGenericParameters = [{ targetName: "T", targetKind: "type", variadic: false }];
  assert.throws(() => createMojoProviderPackage(generic), /invalid closed source-value factory/u);
});
