import assert from "node:assert/strict";
import test from "node:test";
import { selectMojoSourceValueAccessors } from "../../../dist/analysis/conversions/js-value-accessors.js";

const sourceType = { kind: "target-named", id: "proof.Options", modulePath: ["proof"], name: "Options" };
const resultType = { kind: "source-primitive", name: "int32" };

function fixture() {
  const declaration = Object.freeze({});
  const selectedDeclaration = Object.freeze({});
  const symbol = Object.freeze({});
  const rootSymbol = Object.freeze({});
  const definition = { declaration: Object.freeze({}), sourceFile: Object.freeze({}) };
  const getter = { declaration, name: "get_value", static: false, asynchronous: false, parameters: [], typeParameters: [], resultType };
  const selectedGetter = { ...getter, declaration: selectedDeclaration, name: "selected_get_value" };
  const descriptors = new WeakMap([
    [declaration, { runtimeProperty: true, read: getter }],
    [selectedDeclaration, { runtimeProperty: true, read: selectedGetter }],
  ]);
  const context = {
    source: { semantics: { forFile: () => ({
      declarations: {
        declaredType: () => ({}),
        symbolDeclarations: (candidate) => candidate === rootSymbol ? [declaration] : [],
      },
      types: { propertyInfos: () => [{ name: "value", symbol, rootSymbols: [rootSymbol] }] },
    }) } },
    accessorByDeclaration: descriptors,
    projectRelationships: {
      definitionForType: () => definition,
      memberImplementation: (owner, member) => {
        assert.equal(owner, definition);
        assert.equal(member, declaration);
        return { kind: "resolved", implementation: { declaration: selectedDeclaration } };
      },
      instantiateMemberType: (member, receiver, type) => {
        assert.equal(member, selectedDeclaration);
        assert.equal(receiver, sourceType);
        assert.equal(type, resultType);
        return resultType;
      },
    },
  };
  return { context, declaration, selectedDeclaration };
}

test("property readers follow exact transient roots and selected overridden getter identities", () => {
  const { context, selectedDeclaration } = fixture();
  assert.deepEqual(selectMojoSourceValueAccessors(sourceType, new Set(), context), [{
    sourceName: "value", declaration: selectedDeclaration, name: "selected_get_value", resultType,
  }]);
});

test("a selected setter-only descriptor hides an inherited getter", () => {
  const { context, selectedDeclaration } = fixture();
  context.accessorByDeclaration.set(selectedDeclaration, { runtimeProperty: true });
  assert.deepEqual(selectMojoSourceValueAccessors(sourceType, new Set(), context), []);
});

test("own fields and private descriptors do not invoke prototype getter selection", () => {
  const { context, declaration } = fixture();
  context.projectRelationships.memberImplementation = () => { throw new Error("No prototype selection expected"); };
  assert.deepEqual(selectMojoSourceValueAccessors(sourceType, new Set(["value"]), context), []);
  context.accessorByDeclaration.get(declaration).runtimeProperty = false;
  assert.deepEqual(selectMojoSourceValueAccessors(sourceType, new Set(), context), []);
});

test("missing implementation or target descriptor never substitutes a same-named getter", () => {
  const missing = fixture();
  missing.context.projectRelationships.memberImplementation = () => ({ kind: "missing" });
  assert.equal(selectMojoSourceValueAccessors(sourceType, new Set(), missing.context), undefined);
  const unbound = fixture();
  unbound.context.accessorByDeclaration.delete(unbound.selectedDeclaration);
  assert.equal(selectMojoSourceValueAccessors(sourceType, new Set(), unbound.context), undefined);
});
