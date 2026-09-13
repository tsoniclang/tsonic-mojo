import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";
import { mutationProvider, mutationSource, mutationSourceFor } from "../../helpers/mutation-provider.mjs";

for (const field of [false, true]) {
  test(`provider ${field ? "native locations" : "accessors"} separate source numeric results from wider writes`, () => {
    const result = compileMojo({ target: { id: "mojo", options: { outputType: "lib" } }, capabilities: [mutationProvider({ field })], files: { "index.ts": mutationSourceFor(field) } });
    assert.deepEqual(result.diagnostics, []);
    const text = artifactTexts(result).filter(({ path }) => path.startsWith("src/")).map(({ text }) => text).join("\n");
    assert.match(text, /def change[\[(]/u);
    assert.match(text, /Float64\(/u);
    assert.match(text, /write_global/u);
    assert.match(text, field ? /\.stored =/u : /\.write\(/u);
    assert.doesNotMatch(text, /return .*Float64\(/u);
  });
}

test("same printed provider type names do not make a conflicting write carrier admissible", () => {
  const capability = mutationProvider({ alter(definition) {
    return { ...definition, operations: definition.operations.map((operation) =>
      operation.operationKind !== "property-set" ? operation : {
        ...operation, parameterTypes: [{ ...definition.types[0].targetType, id: "fixture.unrelated.Counter" }],
      }) };
  } });
  const result = compileMojo({ capabilities: [capability], files: { "index.ts": mutationSource } });
  assert.deepEqual(result.artifacts, []);
  assert.ok(result.diagnostics.some(({ code }) => code === "MOJO_PROVIDER_PROPERTY_WRITE_CONVERSION_UNPROVEN"));
});
