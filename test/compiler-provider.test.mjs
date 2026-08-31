import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMojoCompilerMetadataLoader } from "../dist/providers/compiler/mojo-doc.js";
import { createMojoCompilerProjectSnapshot } from "../dist/providers/compiler/snapshot/source-snapshot.js";
import { projectMojoCompilerModule } from "../dist/providers/compiler/projection/projection.js";
import { mojoCompilerModuleSpecifier } from "../dist/providers/compiler/projection/module-specifier.js";
import { parseMojoCompilerType } from "../dist/providers/compiler/model/type-parser.js";

const root = fileURLToPath(new URL("fixtures/compiler-provider", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const importRoot = join(root, "imports");
const sourceRoot = join(importRoot, "probe");
const fakeMojo = join(root, "fake-mojo.mjs");

function configuration() {
  return Object.freeze({
    command: Object.freeze({
      executable: process.execPath,
      arguments: Object.freeze([fakeMojo]),
      workingDirectory: dirname(root),
    }),
    packages: Object.freeze([Object.freeze({
      kind: "package",
      id: "fixture-probe",
      alias: "probe",
      packageName: "probe",
      version: "1.0.0",
      importRoot,
      sourceRoot,
    })]),
  });
}

test("compiler snapshots close exact command, environment, package, module, and source identity", () => {
  const snapshot = createMojoCompilerProjectSnapshot(configuration(), "1.1.0.dev2026083005");
  assert.equal(snapshot.packages.length, 1);
  assert.deepEqual(snapshot.packages[0].modules.map(({ modulePath }) => modulePath), [["api"]]);
  assert.equal(snapshot.packages[0].modules[0].byteLength, readFileSync(join(sourceRoot, "api.mojo")).byteLength);
  assert.match(snapshot.digest, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(snapshot));
});

test("compiler metadata extraction normalizes exact conventions, keywords, constructors, and receivers", () => {
  const providerConfiguration = configuration();
  const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
  const package_ = snapshot.packages[0];
  const source = package_.modules[0];
  const loader = createMojoCompilerMetadataLoader(providerConfiguration, join(repositoryRoot, ".temp", "compiler-provider-test"));
  try {
    const model = loader.module({ snapshot, package: package_, module: source });
    const sum = model.functions[0];
    assert.deepEqual(sum.arguments.map(({ convention, position }) => [convention, position]), [
      ["imm", "positional-or-keyword"],
      ["imm", "keyword"],
    ]);
    const counter = model.declarations.find(({ name }) => name === "Counter");
    assert.equal(counter.kind, "struct");
    assert.equal(counter.functions.find(({ name }) => name === "increment").arguments[0].convention, "mut");

    const moduleSpecifier = mojoCompilerModuleSpecifier(package_, ["api"]);
    const projection = projectMojoCompilerModule(snapshot, package_, model, {
      providerModuleId: "fixture-probe:api",
      moduleSpecifier,
    });
    assert.deepEqual(projection.declarationModel.exports.map(({ name }) => name), ["Counter", "sum"]);
    const sumOperation = projection.operations.find(({ exportId }) => exportId.endsWith("export:function:sum"));
    assert.equal(sumOperation.target.arguments[1].nativeName, "right");
    assert.equal(sumOperation.target.arguments[1].position, "keyword");
    assert.equal(projection.operations.some(({ operationKind }) => operationKind === "constructor"), true);
    assert.equal(projection.operations.some(({ operationKind }) => operationKind === "property-set"), true);
  } finally {
    loader.close();
  }
});

test("compiler type parser preserves references, origins, generic values, and function effects", () => {
  assert.deepEqual(
    parseMojoCompilerType("ref[self.value] List[Int32]", undefined),
    {
      kind: "reference",
      origin: "self.value",
      target: {
        kind: "named",
        name: "List",
        arguments: [{ kind: "type", type: { kind: "named", name: "Int32", arguments: [] } }],
      },
    },
  );
  assert.deepEqual(
    parseMojoCompilerType("def(Int32) thin raises Error -> String", undefined),
    {
      kind: "function",
      parameters: [{ kind: "named", name: "Int32", arguments: [] }],
      result: { kind: "named", name: "String", arguments: [] },
      thin: true,
      raises: true,
      errorType: { kind: "named", name: "Error", arguments: [] },
    },
  );
  assert.throws(
    () => parseMojoCompilerType("External[Unclassified]", "/external/External"),
    /not classified by machine-readable metadata/u,
  );
});
