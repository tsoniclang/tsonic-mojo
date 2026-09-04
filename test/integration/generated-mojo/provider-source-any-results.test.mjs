import assert from "node:assert/strict";
import test from "node:test";
import {
  createMojoProviderPackage,
  mojoLifecycleTraitTargetType,
  mojoNamedTargetType,
  mojoStringTargetType,
} from "../../../dist/public/provider.js";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const moduleSpecifier = "@fixture/source-any";
const boxId = `${moduleSpecifier}::Box`;
const boxType = mojoNamedTargetType("fixture.source-any.Box", ["fixture_any"], "Box");
const stringType = mojoStringTargetType();
const anyType = Object.freeze({ kind: "any" });
const sourceString = Object.freeze({ kind: "string" });
const sourceNumber = Object.freeze({ kind: "number" });

function providerPackage(functionResult = anyType) {
  const readId = `${moduleSpecifier}::read`;
  const valueId = `${moduleSpecifier}::value`;
  return createMojoProviderPackage({
    id: "@fixture/mojo-source-any",
    displayName: "Fixture Mojo source-any results",
    version: "1.0.0",
    modules: Object.freeze([Object.freeze({
      moduleSpecifier,
      providerModuleId: "fixture.mojo.source-any",
      exports: Object.freeze([
        Object.freeze({
          id: readId,
          name: "read",
          kind: "function",
          signatures: Object.freeze([Object.freeze({
            id: `${readId}()`,
            name: "read",
            parameters: Object.freeze([]),
            returnType: functionResult,
          })]),
        }),
        Object.freeze({ id: valueId, name: "value", kind: "value", type: anyType }),
        Object.freeze({
          id: boxId,
          name: "Box",
          kind: "class",
          members: Object.freeze([
            Object.freeze({ id: `${boxId}.value`, name: "value", kind: "property", readonly: true, type: anyType }),
            Object.freeze({ id: `${boxId}.current`, name: "current", kind: "property", readonly: true, static: true, type: anyType }),
            Object.freeze({
              id: `${boxId}.indexer`,
              name: "indexer",
              kind: "indexer",
              signatures: Object.freeze([Object.freeze({
                id: `${boxId}.indexer(key)`,
                name: "indexer",
                parameters: Object.freeze([Object.freeze({ name: "key", type: sourceString })]),
                returnType: anyType,
              })]),
            }),
          ]),
        }),
      ]),
    })]),
    types: Object.freeze([Object.freeze({
      exportId: boxId,
      sourceGenericParameters: Object.freeze([]),
      targetType: boxType,
      conformances: Object.freeze([
        "implicitly-copyable",
        "movable",
        "deinitializable",
      ].map((lifecycleRole) => Object.freeze({
        trait: mojoLifecycleTraitTargetType(lifecycleRole),
        lifecycleRole,
      }))),
    })]),
    operations: Object.freeze([
      Object.freeze({
        exportId: readId,
        signatureId: `${readId}()`,
        operationKind: "call",
        target: Object.freeze({
          kind: "function-call",
          modulePath: Object.freeze(["fixture_any"]),
          name: "read",
          arguments: Object.freeze([]),
        }),
        parameterTypes: Object.freeze([]),
        resultType: stringType,
      }),
      Object.freeze({
        exportId: valueId,
        operationKind: "property",
        target: Object.freeze({
          kind: "constant",
          modulePath: Object.freeze(["fixture_any"]),
          name: "value",
        }),
        resultType: stringType,
      }),
      Object.freeze({
        exportId: boxId,
        memberId: `${boxId}.value`,
        operationKind: "property",
        target: Object.freeze({
          kind: "property-read",
          access: Object.freeze({ kind: "member", name: "value" }),
          receiver: "imm",
        }),
        receiverType: boxType,
        resultType: stringType,
      }),
      Object.freeze({
        exportId: boxId,
        memberId: `${boxId}.current`,
        operationKind: "property",
        target: Object.freeze({
          kind: "function-read",
          modulePath: Object.freeze(["fixture_any"]),
          name: "current",
        }),
        resultType: stringType,
      }),
      Object.freeze({
        exportId: boxId,
        memberId: `${boxId}.indexer`,
        signatureId: `${boxId}.indexer(key)`,
        operationKind: "indexer",
        target: Object.freeze({
          kind: "index-read",
          access: Object.freeze({ kind: "method", name: "get" }),
          receiver: "imm",
          index: Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        }),
        receiverType: boxType,
        parameterTypes: Object.freeze([stringType]),
        resultType: stringType,
      }),
    ]),
    runtimePackages: Object.freeze([]),
  });
}

test("source any preserves every exact provider result carrier", () => {
  const result = compileMojo({
    packages: [providerPackage()],
    files: {
      "index.ts": [
        `import { Box, read, value } from "${moduleSpecifier}";`,
        "export function values(box: Box): string[] {",
        "  return [read(), value, box.value, box[\"key\"], Box.current];",
        "}",
        "export function main(): void {}",
      ].join("\n"),
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def values"));
  assert.ok(source);
  assert.match(source.text, /List\[String\]/u);
  assert.match(source.text, /read\(\)/u);
  assert.match(source.text, /\bvalue\b/u);
  assert.match(source.text, /box\.value/u);
  assert.match(source.text, /box\.get\("key"\)/u);
  assert.match(source.text, /current\(\)/u);
});

test("non-any source results still require an exact conversion", () => {
  const result = compileMojo({
    packages: [providerPackage(sourceNumber)],
    files: {
      "index.ts": `import { read } from "${moduleSpecifier}"; export function value(): number { return read(); }`,
    },
  });
  assert.deepEqual(result.artifacts, []);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_CALL_RESULT_CONVERSION_UNPROVEN"));
});
