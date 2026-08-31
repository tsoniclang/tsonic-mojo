import assert from "node:assert/strict";
import test from "node:test";
import { createMojoProviderPackage } from "../dist/public/provider.js";

const sourceFunction = Object.freeze({
  id: "@fixture/math::sum",
  name: "sum",
  kind: "function",
  signatures: Object.freeze([Object.freeze({
    id: "@fixture/math::sum(left,right)",
    parameters: Object.freeze([
      Object.freeze({ name: "left", type: Object.freeze({ kind: "number" }) }),
      Object.freeze({ name: "right", type: Object.freeze({ kind: "number" }) }),
    ]),
    returnType: Object.freeze({ kind: "number" }),
  })]),
});

function definition(overrides = {}) {
  return {
    id: "@fixture/mojo-math",
    displayName: "Fixture Mojo math",
    version: "1.0.0",
    modules: [{
      moduleSpecifier: "@fixture/math",
      providerModuleId: "fixture.mojo.math",
      exports: [sourceFunction],
    }],
    operations: [{
      exportId: sourceFunction.id,
      signatureId: sourceFunction.signatures[0].id,
      operationKind: "call",
      target: {
        kind: "function-call",
        modulePath: ["fixture_math"],
        name: "sum",
        arguments: ["immutable-reference", "immutable-reference"],
      },
      parameterTypes: [
        { kind: "source-primitive", name: "float64" },
        { kind: "source-primitive", name: "float64" },
      ],
      resultType: { kind: "source-primitive", name: "float64" },
    }],
    runtimePackages: [{ packageName: "fixture_math", packagePath: "/fixture/math" }],
    ...overrides,
  };
}

test("provider packages close and freeze source, ABI, and runtime metadata", () => {
  const capability = createMojoProviderPackage(definition());
  assert.ok(Object.isFrozen(capability));
  const contribution = capability.createTargetContributions({})[0];
  assert.ok(Object.isFrozen(contribution.definition));
  assert.ok(Object.isFrozen(contribution.definition.operations[0].target.arguments));
  assert.throws(() => {
    contribution.definition.modules.push({});
  }, TypeError);
});

test("provider packages reject operations without an exact source declaration", () => {
  assert.throws(
    () => createMojoProviderPackage(definition({
      operations: [{
        ...definition().operations[0],
        exportId: "@fixture/math::missing",
      }],
    })),
    /no exported declaration/u,
  );
});

test("provider packages reject contradictory operation identities", () => {
  const operation = definition().operations[0];
  assert.throws(
    () => createMojoProviderPackage(definition({
      operations: [operation, { ...operation, resultType: { kind: "source-primitive", name: "int32" } }],
    })),
    /duplicated/u,
  );
});

test("provider packages reject a signature owned by another declaration", () => {
  assert.throws(
    () => createMojoProviderPackage(definition({
      operations: [{
        ...definition().operations[0],
        signatureId: "@fixture/math::missing(left,right)",
      }],
    })),
    /signature.*not owned/u,
  );
});

test("provider packages reject source and target ABI arity drift", () => {
  assert.throws(
    () => createMojoProviderPackage(definition({
      operations: [{
        ...definition().operations[0],
        parameterTypes: [{ kind: "source-primitive", name: "float64" }],
      }],
    })),
    /inconsistent source, target, and ABI arity/u,
  );
});

test("provider packages reject duplicate public aliases", () => {
  assert.throws(
    () => createMojoProviderPackage(definition({
      moduleAliases: [
        { moduleSpecifier: "math", canonicalModuleSpecifier: "@fixture/math" },
        { moduleSpecifier: "math", canonicalModuleSpecifier: "@fixture/math" },
      ],
    })),
    /alias 'math' is duplicated/u,
  );
});
