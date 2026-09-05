import assert from "node:assert/strict";
import test from "node:test";
import {
  createMojoProviderPackage,
  mojoCallableTargetType,
  mojoStringTargetType,
  mojoUnitTargetType,
} from "../../../dist/public/provider.js";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

const moduleSpecifier = "@fixture/callback";
const exportId = `${moduleSpecifier}::observe`;
const signatureId = `${exportId}(callback)`;
const sourceCallback = Object.freeze({
  kind: "function",
  id: `${signatureId}::parameter:callback`,
  parameters: Object.freeze([
    Object.freeze({ name: "value", type: Object.freeze({ kind: "any" }) }),
  ]),
  returnType: Object.freeze({ kind: "void" }),
});

function callbackPackage(convention = "imm") {
  const unit = mojoUnitTargetType();
  const callback = mojoCallableTargetType([
    Object.freeze({
      convention,
      passing: "plain",
      type: mojoStringTargetType(),
    }),
  ], unit, true);
  return createMojoProviderPackage({
    id: "@fixture/mojo-callback",
    displayName: "Fixture Mojo callback",
    version: "1.0.0",
    modules: Object.freeze([Object.freeze({
      moduleSpecifier,
      providerModuleId: "fixture.mojo.callback",
      exports: Object.freeze([Object.freeze({
        id: exportId,
        name: "observe",
        kind: "function",
        signatures: Object.freeze([Object.freeze({
          id: signatureId,
          name: "observe",
          parameters: Object.freeze([
            Object.freeze({ name: "callback", type: sourceCallback }),
          ]),
          returnType: Object.freeze({ kind: "void" }),
        })]),
      })]),
    })]),
    operations: Object.freeze([Object.freeze({
      exportId,
      signatureId,
      operationKind: "call",
      target: Object.freeze({
        kind: "function-call",
        modulePath: Object.freeze(["fixture_callback"]),
        name: "observe",
        arguments: Object.freeze([
          Object.freeze({ convention: "imm", position: "positional-or-keyword" }),
        ]),
      }),
      parameterTypes: Object.freeze([callback]),
      resultType: unit,
      raises: true,
    })]),
    runtimePackages: Object.freeze([]),
  });
}

function compileWith(convention) {
  return compileMojo({
    packages: [callbackPackage(convention)],
    files: {
      "index.ts": [
        `import { observe } from "${moduleSpecifier}";`,
        "export function main(): void {",
        "  observe(value => { value; });",
        "}",
      ].join("\n"),
    },
  });
}

test("provider callbacks close from the exact retained target callable", () => {
  const result = compileWith("imm");
  assert.deepEqual(result.diagnostics, []);
  const source = artifactTexts(result).find(({ text }) => text.includes("def tsonic_main"));
  assert.ok(source);
  assert.match(source.text, /from fixture_callback import observe/u);
  assert.match(source.text, /RaisingCallable\[\s*Tuple\[String\],\s*NoneType,?\s*\]/u);
  assert.match(source.text, /var \(value,\) = _callable_environment_arguments\^/u);
  assert.equal((source.text.match(/allocate_callable_environment\(/gu) ?? []).length, 1);
  assert.match(source.text, /observe\(\s*RaisingCallable/u);
});

test("contextual callback ABI contradictions fail at analysis", () => {
  const result = compileWith("var");
  assert.deepEqual(result.artifacts, []);
  assert.deepEqual(result.diagnostics.map(({ code }) => code), [
    "MOJO_CONTEXTUAL_CALLABLE_PARAMETER_ABI_MISMATCH",
    "MOJO_CALLABLE_EXPRESSION_SELECTION_UNRESOLVED",
  ]);
});
