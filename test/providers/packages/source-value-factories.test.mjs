import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../../../dist/public/provider.js";
import { createMojoProviderSourceValueIndex } from "../../../dist/providers/packages/source-values.js";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";
import { mojoValueConversionEquals } from "../../../dist/target-model/conversions/equality.js";
import { mojoConversionRaises } from "../../../dist/analysis/resources/effects.js";

const carrier = Object.freeze({ kind: "target-named", id: "fixture.native.Record", modulePath: ["fixture"], name: "Record" });
const factory = Object.freeze({ modulePath: ["fixture", "values"], name: "retain_record" });
const extraction = Object.freeze({ modulePath: ["fixture", "values"], name: "recover_record" });
const erased = Object.freeze({ kind: "dynamic", domain: "js" });

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

test("provider extraction is independent, immutable and exact in both directions", () => {
  const input = definition();
  input.types[0].sourceValueExtraction = { modulePath: ["fixture", "values"], name: "recover_record" };
  const capability = createMojoProviderPackage(input);
  input.types[0].sourceValueExtraction.name = "changed";
  const row = capability.createTargetContributions({})[0].definition.types[0];
  assert.deepEqual(row.sourceValueExtraction, extraction);
  assert.ok(Object.isFrozen(row.sourceValueExtraction));
  const index = createMojoProviderSourceValueIndex([row]);
  const selected = classifyMojoValueConversion(erased, carrier, undefined, undefined, undefined, index.extractionForType);
  assert.equal(selected.kind, "resolved");
  assert.equal(selected.conversion.kind, "js-value-extract");
  assert.deepEqual(selected.conversion.extraction, extraction);
  assert.equal(mojoConversionRaises(selected.conversion), true);
  assert.equal(mojoValueConversionEquals(selected.conversion, { ...selected.conversion,
    extraction: { ...extraction, name: "different_record" } }), false);
  assert.equal(index.extractionForType({ ...carrier, id: "unrelated.Record" }), undefined);
  assert.equal(index.extractionForType({ ...carrier, modulePath: ["unrelated"] }), undefined);
  assert.equal(createMojoProviderSourceValueIndex([definition().types[0]]).extractionForType(carrier), undefined);
  const { sourceValueFactory: _factory, ...extractionOnly } = row;
  const extractionIndex = createMojoProviderSourceValueIndex([extractionOnly]);
  assert.equal(extractionIndex.factoryForType(carrier), undefined);
  assert.deepEqual(extractionIndex.extractionForType(carrier), extraction);
  assert.throws(() => createMojoProviderSourceValueIndex([
    row, { ...row, sourceValueExtraction: { ...extraction, name: "conflict" } },
  ]), /conflicting source-value extractions/u);
});

test("erased recovery does not speculatively choose a member of a union or optional", () => {
  const row = { ...definition().types[0], sourceValueExtraction: extraction };
  const index = createMojoProviderSourceValueIndex([row]);
  for (const target of [
    { kind: "optional", value: carrier },
    { kind: "union", members: [carrier, { kind: "native-string" }] },
  ]) {
    const selected = classifyMojoValueConversion(erased, target, undefined, undefined, undefined, index.extractionForType);
    assert.equal(selected.kind, "unsupported");
    assert.match(selected.reason, /complete discriminant/u);
  }
  assert.equal(classifyMojoValueConversion(erased, carrier).kind, "unsupported");
});

test("extraction metadata cannot contain guessed syntax, effects or generic instantiation", () => {
  for (const invalid of [null, { modulePath: [], name: "recover" },
    { modulePath: ["fixture"], name: "recover(value)" },
    { modulePath: ["fixture"], name: "recover", raises: false }]) {
    const input = definition();
    input.types[0].sourceValueExtraction = invalid;
    assert.throws(() => createMojoProviderPackage(input), /invalid closed source-value extraction/u);
  }
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
