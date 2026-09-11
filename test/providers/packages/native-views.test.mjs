import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../../../dist/public/provider.js";
import { createMojoProviderNativeViewIndex } from "../../../dist/providers/packages/native-views.js";
import { classifyMojoValueConversion } from "../../../dist/policy/conversions/selection.js";
import { mojoValueConversionEquals } from "../../../dist/target-model/conversions/equality.js";

const source = { kind: "target-named", id: "fixture.Socket", modulePath: ["fixture"], name: "Socket" };
const target = { kind: "target-named", id: "fixture.Channel", modulePath: ["fixture"], name: "Channel" };
const factory = { modulePath: ["fixture"], name: "retain_channel" };
function definition() {
  return { id: "fixture", displayName: "Native views", version: "1", modules: [{ moduleSpecifier: "fixture:views", providerModuleId: "fixture.views", exports: [
    { id: "socket", name: "Socket", kind: "interface", members: [] },
    { id: "channel", name: "Channel", kind: "interface", members: [] },
  ] }], types: [
    { exportId: "socket", sourceGenericParameters: [], targetType: source, nativeViews: [{ targetType: target, factory: { ...factory, modulePath: [...factory.modulePath] } }] },
    { exportId: "channel", sourceGenericParameters: [], targetType: target },
  ], operations: [], runtimePackages: [{ packageName: "fixture", packagePath: "/fixture" }] };
}

test("native views are immutable exact directed relations, not structural guesses", () => {
  const input = definition();
  const capability = createMojoProviderPackage(input);
  input.types[0].nativeViews[0].factory.name = "mutated";
  const rows = capability.createTargetContributions({})[0].definition.types;
  const index = createMojoProviderNativeViewIndex(rows);
  assert.deepEqual(index(source, target), factory);
  assert.equal(index(target, source), undefined);
  assert.equal(index({ ...source, id: "other.Socket" }, target), undefined);
  const result = classifyMojoValueConversion(source, target, undefined, undefined, undefined, undefined, undefined, index);
  assert.equal(result.kind, "resolved");
  assert.equal(result.conversion.kind, "provider-native-view");
  assert.equal(mojoValueConversionEquals(result.conversion, { ...result.conversion, factory: { ...factory, name: "wrong" } }), false);
  assert.equal(classifyMojoValueConversion(source, target).kind, "unsupported");
  assert.throws(() => createMojoProviderNativeViewIndex([rows[0], { ...rows[0], nativeViews: [{ targetType: target, factory: { ...factory, name: "conflict" } }] }]), /conflicting provider factories/);
});

test("invalid native view metadata fails at the provider boundary", () => {
  for (const mutate of [
    (value) => { value.types[0].nativeViews[0].factory.name = "call(value)"; },
    (value) => { value.types[0].nativeViews[0].factory.modulePath = []; },
    (value) => { value.types[0].nativeViews[0].targetType = source; },
    (value) => { value.types[0].nativeViews.push(value.types[0].nativeViews[0]); },
    (value) => { value.types[0].nativeViews[0].targetType = { ...target, id: "undeclared" }; },
    (value) => { value.types[0].nativeViews[0].factory.raises = false; },
  ]) {
    const value = definition();
    mutate(value);
    assert.throws(() => createMojoProviderPackage(value), /native view/);
  }
});
