import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createMojoCompilerMetadataLoader } from "../dist/providers/compiler/mojo-doc.js";
import { createMojoCompilerProjectSnapshot } from "../dist/providers/compiler/snapshot/source-snapshot.js";
import { projectMojoCompilerModule } from "../dist/providers/compiler/projection/projection.js";
import { mojoCompilerModuleSpecifier } from "../dist/providers/compiler/projection/module-specifier.js";
import { parseMojoCompilerType } from "../dist/providers/compiler/model/type-parser.js";
import { analyzeMojoRuntimePackages } from "../dist/analysis/runtime/references.js";
import { materializeMojoOutputPlan } from "../dist/backend/emission/materialize.js";

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
  assert.deepEqual(snapshot.packages[0].modules.map(({ modulePath }) => modulePath), [
    ["_private"],
    ["api"],
    ["traits"],
  ]);
  const api = snapshot.packages[0].modules.find(({ modulePath }) => modulePath.join(".") === "api");
  assert.ok(api);
  assert.equal(api.byteLength, readFileSync(join(sourceRoot, "api.mojo")).byteLength);
  assert.match(snapshot.digest, /^[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(snapshot));
});

test("compiler metadata extraction normalizes exact conventions, keywords, constructors, and receivers", () => {
  const providerConfiguration = configuration();
  const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
  const package_ = snapshot.packages[0];
  const source = package_.modules.find(({ modulePath }) => modulePath.join(".") === "api");
  assert.ok(source);
  const loader = createMojoCompilerMetadataLoader(join(repositoryRoot, ".temp", "compiler-provider-test"));
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
    assert.deepEqual(
      projection.declarationModel.exports.map(({ name }) => name),
      ["Bucket", "Counter", "collect", "sum"],
    );
    const sumOperation = projection.operations.find(({ exportId }) => exportId.endsWith("export:function:sum"));
    assert.equal(sumOperation.target.arguments[1].nativeName, "right");
    assert.equal(sumOperation.target.arguments[1].position, "keyword");
    assert.equal(projection.operations.some(({ operationKind }) => operationKind === "constructor"), true);
    assert.equal(projection.operations.some(({ operationKind }) => operationKind === "property-set"), true);
    const collectOperation = projection.operations.find(({ exportId }) =>
      exportId.endsWith("export:function:collect"));
    assert.deepEqual(collectOperation.target.genericParameters.map((parameter) => ({
      kind: parameter.kind,
      name: parameter.name,
      position: parameter.position,
      variadic: parameter.variadic,
      constraints: parameter.constraints.length,
    })), [
      {
        kind: "type",
        name: "Ts",
        position: "positional-or-keyword",
        variadic: true,
        constraints: 2,
      },
      {
        kind: "value",
        name: "flag",
        position: "keyword",
        variadic: false,
        constraints: 1,
      },
    ]);
    const bucket = projection.types.find(({ exportId }) => exportId.endsWith("export:struct:Bucket"));
    assert.deepEqual(bucket.conformances.map(({ condition }) => condition), [
      undefined,
      { kind: "conforms-to", parameterName: "T", traitNames: ["Copyable"] },
    ]);
    assert.equal(bucket.associatedAliases[0].name, "Element");
    assert.deepEqual(bucket.associatedAliases[0].valueType, { kind: "type-parameter", name: "T" });
    const itemOperation = projection.operations.find(({ memberId }) =>
      memberId?.endsWith("::method:item") === true);
    assert.equal(itemOperation.resultType.kind, "associated");
  } finally {
    loader.close();
  }
});

test("compiler type parser preserves references, origins, generic values, and function effects", () => {
  assert.deepEqual(
    parseMojoCompilerType("Origin[mut=origin.mut]", undefined, {
      originParameters: new Set(["origin"]),
    }),
    {
      kind: "named",
      name: "Origin",
      arguments: [{ kind: "value", name: "mut", expression: "origin.mut" }],
    },
  );
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

test("compiler metadata uses the exact snapshotted environment and persistent document cache", () => {
  const cacheRoot = join(repositoryRoot, ".temp", `compiler-provider-environment-${process.pid}`);
  const logPath = join(cacheRoot, "commands.log");
  mkdirSync(cacheRoot, { recursive: true });
  const previousEnvironment = process.env.TSONIC_MOJO_PROVIDER_ENV;
  const previousExpected = process.env.TSONIC_MOJO_PROVIDER_EXPECT_ENV;
  const previousLog = process.env.TSONIC_MOJO_PROVIDER_LOG;
  process.env.TSONIC_MOJO_PROVIDER_ENV = "snapshotted";
  process.env.TSONIC_MOJO_PROVIDER_EXPECT_ENV = "snapshotted";
  process.env.TSONIC_MOJO_PROVIDER_LOG = logPath;
  try {
    const providerConfiguration = configuration();
    const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
    const package_ = snapshot.packages[0];
    const source = package_.modules.find(({ modulePath }) => modulePath.join(".") === "api");
    assert.ok(source);
    const traits = package_.modules.find(({ modulePath }) => modulePath.join(".") === "traits");
    assert.ok(traits);
    process.env.TSONIC_MOJO_PROVIDER_ENV = "mutated-after-snapshot";

    const first = createMojoCompilerMetadataLoader(cacheRoot);
    try {
      assert.equal(first.module({ snapshot, package: package_, module: source }).functions[0].name, "sum");
      assert.equal(first.module({ snapshot, package: package_, module: traits }).declarations.length, 3);
    } finally {
      first.close();
    }
    assert.equal(readFileSync(logPath, "utf8"), "doc\n");

    const second = createMojoCompilerMetadataLoader(cacheRoot);
    try {
      assert.equal(second.module({ snapshot, package: package_, module: source }).functions[0].name, "sum");
    } finally {
      second.close();
    }
    assert.equal(
      readFileSync(logPath, "utf8"),
      "doc\n",
      "the exact cached package document avoids compiler re-entry",
    );

    const documentPath = join(
      cacheRoot,
      "documents",
      snapshot.digest,
      encodeURIComponent(package_.id),
      "package.json",
    );
    assert.equal(existsSync(documentPath), true);
    writeFileSync(documentPath, "corrupt");
    const recovered = createMojoCompilerMetadataLoader(cacheRoot);
    try {
      assert.equal(recovered.module({ snapshot, package: package_, module: source }).functions[0].name, "sum");
    } finally {
      recovered.close();
    }
    assert.equal(
      readFileSync(logPath, "utf8"),
      "doc\ndoc\n",
      "corrupt cache data is regenerated exactly once",
    );
  } finally {
    restoreEnvironment("TSONIC_MOJO_PROVIDER_ENV", previousEnvironment);
    restoreEnvironment("TSONIC_MOJO_PROVIDER_EXPECT_ENV", previousExpected);
    restoreEnvironment("TSONIC_MOJO_PROVIDER_LOG", previousLog);
  }
});

test("compiler package documents cannot publish modules absent from the immutable source snapshot", () => {
  const cacheRoot = join(repositoryRoot, ".temp", `compiler-provider-unexpected-${process.pid}`);
  const previousUnexpected = process.env.TSONIC_MOJO_PROVIDER_EXTRA_MODULE;
  process.env.TSONIC_MOJO_PROVIDER_EXTRA_MODULE = "unexpected";
  try {
    const snapshot = createMojoCompilerProjectSnapshot(configuration(), "1.1.0.dev2026083005");
    const package_ = snapshot.packages[0];
    const source = package_.modules.find(({ modulePath }) => modulePath.join(".") === "api");
    assert.ok(source);
    const loader = createMojoCompilerMetadataLoader(cacheRoot);
    try {
      assert.throws(
        () => loader.module({ snapshot, package: package_, module: source }),
        /documentation contains 1 module\(s\) absent from its immutable source snapshot/u,
      );
    } finally {
      loader.close();
    }
  } finally {
    restoreEnvironment("TSONIC_MOJO_PROVIDER_EXTRA_MODULE", previousUnexpected);
  }
});

test("corrupt staged sources recover through a private immutable snapshot", () => {
  const cacheRoot = join(repositoryRoot, ".temp", `compiler-provider-staging-${process.pid}`);
  const providerConfiguration = configuration();
  const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
  const package_ = snapshot.packages[0];
  const source = package_.modules.find(({ modulePath }) => modulePath.join(".") === "api");
  assert.ok(source);
  const first = createMojoCompilerMetadataLoader(cacheRoot);
  try {
    first.module({ snapshot, package: package_, module: source });
  } finally {
    first.close();
  }
  const stagedSource = join(
    cacheRoot,
    "snapshots",
    snapshot.digest,
    "imports",
    encodeURIComponent(package_.alias),
    package_.packageName,
    "api.mojo",
  );
  writeFileSync(stagedSource, "corrupt staged source\n");
  const recovered = createMojoCompilerMetadataLoader(cacheRoot);
  try {
    assert.equal(recovered.module({ snapshot, package: package_, module: source }).functions[0].name, "sum");
  } finally {
    recovered.close();
  }
});

test("runtime package artifacts retain the exact analyzed Mojo sources", () => {
  const packagePlan = analyzeMojoRuntimePackages([{
    kind: "mojo-package-path",
    include: importRoot,
    attributes: { packageName: "probe" },
  }])[0];
  assert.deepEqual(packagePlan.sources.map(({ path }) => path), ["_private.mojo", "api.mojo", "traits.mojo"]);
  assert.match(packagePlan.digest, /^[0-9a-f]{64}$/u);
  const output = materializeMojoOutputPlan({
    configuration: {
      packageName: "fixture",
      outputType: "bin",
      project: { kind: "generated" },
      compilerProvider: configuration(),
      toolchainVersion: "1.1.0.dev2026083005",
    },
    module: { imports: [], functions: [] },
    runtimePackages: [packagePlan],
  });
  assert.deepEqual(
    output.artifacts.filter(({ path }) => path.startsWith("packages/")).map(({ path }) => path),
    ["packages/probe/_private.mojo", "packages/probe/api.mojo", "packages/probe/traits.mojo"],
  );
  const project = output.artifacts.find(({ path }) => path === "pixi.toml");
  assert.match(project.text, /-I 'packages'/u);
  assert.doesNotMatch(project.text, new RegExp(importRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
