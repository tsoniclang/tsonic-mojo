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
import { createMojoCompilerMetadataLoader } from "../../../dist/providers/compiler/mojo-doc.js";
import { createMojoCompilerProjectSnapshot } from "../../../dist/providers/compiler/snapshot/source-snapshot.js";
import { projectMojoCompilerModule } from "../../../dist/providers/compiler/projection/projection.js";
import { mojoCompilerModuleSpecifier } from "../../../dist/providers/compiler/projection/module-specifier.js";
import { parseMojoCompilerConformanceCondition } from "../../../dist/providers/compiler/model/condition-parser.js";
import { parseMojoCompilerType } from "../../../dist/providers/compiler/model/type-parser.js";
import { analyzeMojoRuntimePackages } from "../../../dist/analysis/runtime/references.js";
import { materializeMojoOutputPlan } from "../../../dist/backend/emission/materialize.js";
import { collectMojoProviderSemanticsFromDefinitions } from "../../../dist/providers/packages/semantics.js";
import { createMojoCompilerProviderSession } from "../../../dist/providers/compiler/session.js";

const root = fileURLToPath(new URL("../../fixtures/compiler-provider", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const importRoot = join(root, "imports");
const sourceRoot = join(importRoot, "probe");
const fakeMojo = join(root, "fake-mojo.mjs");
const fakeMojoLanguageServer = join(root, "fake-mojo-lsp.mjs");

function configuration() {
  return Object.freeze({
    command: Object.freeze({
      executable: process.execPath,
      arguments: Object.freeze([fakeMojo]),
      workingDirectory: dirname(root),
    }),
    languageServer: Object.freeze({
      executable: process.execPath,
      arguments: Object.freeze([fakeMojoLanguageServer]),
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
    [],
    ["_private"],
    ["api"],
    ["surface"],
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
  const loader = createMojoCompilerMetadataLoader(
    join(repositoryRoot, ".temp", `compiler-provider-test-${process.pid}`),
  );
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
      exports: model.availableExports.map(({ name }) => ({ declarationName: name, exportName: name })),
    });
    assert.deepEqual(
      projection.declarationModel.exports.map(({ name }) => name),
      ["Bucket", "Counter", "classify", "collect", "sum"],
    );
    const sumOperation = projection.operations.find(({ exportId }) => exportId.endsWith("::export:sum"));
    assert.equal(sumOperation.target.arguments[1].nativeName, "right");
    assert.equal(sumOperation.target.arguments[1].position, "keyword");
    assert.equal(projection.operations.some(({ operationKind }) => operationKind === "constructor"), true);
    assert.equal(projection.operations.some(({ operationKind }) => operationKind === "property-set"), true);
    const counterExport = projection.declarationModel.exports.find(({ name }) => name === "Counter");
    const counterType = projection.types.find(({ exportId }) => exportId.endsWith("::export:Counter"));
    assert.equal(counterExport.heritage, undefined);
    assert.equal(counterType.conformances, undefined);
    const indexMember = projection.declarationModel.exports
      .find(({ name }) => name === "Counter").members
      .find(({ kind }) => kind === "indexer");
    assert.equal(indexMember.readonly, undefined);
    assert.equal(indexMember.signatures.length, 1);
    assert.deepEqual(
      projection.operations
        .filter(({ memberId }) => memberId === indexMember.id)
        .map(({ operationKind, target, parameterTypes }) => [
          operationKind,
          target.kind,
          parameterTypes.length,
        ]),
      [
        ["indexer", "index-read", 1],
        ["index-set", "index-write", 2],
      ],
    );
    const collectOperation = projection.operations.find(({ exportId }) =>
      exportId.endsWith("::export:collect"));
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
    const classifyOperation = projection.operations.find(({ exportId }) =>
      exportId.endsWith("::export:classify"));
    assert.deepEqual(classifyOperation.target.genericParameters.map((parameter) => ({
      kind: parameter.kind,
      name: parameter.name,
      position: parameter.position,
      variadic: parameter.variadic,
    })), [
      { kind: "type", name: "T", position: "positional", variadic: false },
      { kind: "origin", name: "origin", position: "inferred", variadic: false },
      { kind: "value", name: "size", position: "keyword", variadic: false },
      { kind: "value", name: "payload", position: "positional-or-keyword", variadic: false },
    ]);
    assert.deepEqual(classifyOperation.target.genericParameters[2].defaultArgument, {
      kind: "compiler-expression",
      expression: "Int(4)",
    });
    const classifyExport = projection.declarationModel.exports.find(({ name }) => name === "classify");
    const sizeParameter = classifyExport.signatures[0].typeParameters.find(({ name }) => name === "size");
    assert.deepEqual(sizeParameter.defaultType, {
      kind: "literal",
      value: "Int(4)",
    });
    const bucket = projection.types.find(({ exportId }) => exportId.endsWith("::export:Bucket"));
    assert.deepEqual(bucket.conformances.map(({ condition }) => condition), [
      undefined,
      { kind: "conforms-to", subject: "T", traitNames: ["Copyable"] },
    ]);
    assert.equal(bucket.associatedAliases[0].name, "Element");
    assert.equal(bucket.associatedAliases[0].category, "type");
    assert.deepEqual(bucket.associatedAliases[0].targetType, { kind: "type-parameter", name: "T" });
    const itemOperation = projection.operations.find(({ memberId }) =>
      memberId?.endsWith("::method:item") === true);
    assert.equal(itemOperation.resultType.kind, "associated");
  } finally {
    loader.close();
  }
});

test("compiler aliases retain exact semantic category, target, value type, and constant operation", () => {
  const snapshot = createMojoCompilerProjectSnapshot(configuration(), "1.1.0.dev2026083005");
  const package_ = snapshot.packages[0];
  const source = package_.modules.find(({ modulePath }) => modulePath.join(".") === "_private");
  assert.ok(source);
  const loader = createMojoCompilerMetadataLoader(
    join(repositoryRoot, ".temp", `compiler-provider-alias-${process.pid}`),
  );
  try {
    const model = loader.module({ snapshot, package: package_, module: source });
    assert.deepEqual(model.declarations.map((declaration) => [
      declaration.name,
      declaration.category,
      declaration.targetType?.kind,
      declaration.valueType?.kind,
    ]), [
      ["TypeAlias", "type", "named", undefined],
      ["OriginAlias", "origin", undefined, "named"],
      ["ValueAlias", "value", undefined, "named"],
    ]);
    const moduleSpecifier = mojoCompilerModuleSpecifier(package_, ["_private"]);
    const projection = projectMojoCompilerModule(snapshot, package_, model, {
      providerModuleId: "fixture-probe:_private",
      moduleSpecifier,
      exports: model.availableExports.map(({ name }) => ({ declarationName: name, exportName: name })),
    });
    assert.deepEqual(projection.declarationModel.exports.map(({ name, kind }) => [name, kind]), [
      ["OriginAlias", "value"],
      ["TypeAlias", "type"],
      ["ValueAlias", "value"],
    ]);
    assert.deepEqual(projection.operations.map(({ operationKind, target }) => [
      operationKind,
      target.kind,
      target.name,
    ]), [
      ["property", "constant", "OriginAlias"],
      ["property", "constant", "ValueAlias"],
    ]);
    const semantics = collectMojoProviderSemanticsFromDefinitions([{
      id: package_.id,
      displayName: "Alias fixture",
      version: package_.version,
      modules: [projection.declarationModel],
      types: projection.types,
      operations: projection.operations,
      runtimePackages: [],
    }]);
    assert.equal(semantics.operations.length, 2);
  } finally {
    loader.close();
  }
});

test("incremental compiler-provider slices isolate unrelated unsupported exports", () => {
  const previousBroken = process.env.TSONIC_MOJO_PROVIDER_BROKEN_EXPORT;
  process.env.TSONIC_MOJO_PROVIDER_BROKEN_EXPORT = "1";
  const cacheRoot = join(repositoryRoot, ".temp", `compiler-provider-slices-${process.pid}`);
  try {
    const providerConfiguration = configuration();
    const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
    const package_ = snapshot.packages[0];
    const source = package_.modules.find(({ modulePath }) => modulePath.join(".") === "api");
    assert.ok(source);
    const loader = createMojoCompilerMetadataLoader(cacheRoot);
    try {
      const sumOnly = loader.module({
        snapshot,
        package: package_,
        module: source,
        requestedExports: ["sum"],
      });
      assert.deepEqual(sumOnly.functions.map(({ name }) => name), ["sum"]);
      assert.deepEqual(sumOnly.declarations, []);
      assert.equal(sumOnly.availableExports.some(({ name }) => name === "BrokenAlias"), true);
      const ordered = loader.module({
        snapshot,
        package: package_,
        module: source,
        requestedExports: ["sum", "Counter"],
      });
      const reordered = loader.module({
        snapshot,
        package: package_,
        module: source,
        requestedExports: ["Counter", "sum", "sum"],
      });
      assert.equal(ordered, reordered);
      const empty = loader.module({
        snapshot,
        package: package_,
        module: source,
        requestedExports: [],
      });
      assert.deepEqual([empty.functions.length, empty.declarations.length], [0, 0]);
      assert.throws(
        () => loader.module({
          snapshot,
          package: package_,
          module: source,
          requestedExports: ["BrokenAlias"],
        }),
        /Unbalanced Mojo compiler expression/u,
      );
      assert.throws(
        () => loader.module({ snapshot, package: package_, module: source }),
        /Unbalanced Mojo compiler expression/u,
      );

      const session = createMojoCompilerProviderSession({
        compilerProvider: providerConfiguration,
        toolchain: {
          kind: "pixi-mojo",
          compilerVersion: "1.1.0.dev2026083005",
          channels: ["conda-forge", "https://conda.modular.com/max-nightly/"],
          platforms: ["linux-64"],
          commandEnvironment: "posix",
        },
      }, { snapshot, loader });
      try {
        const provider = session.sourceProviders[0];
        const moduleSpecifier = mojoCompilerModuleSpecifier(package_, ["api"]);
        const resolution = provider.resolveModule(moduleSpecifier, { resolutionMode: "import" });
        assert.equal(resolution.kind, "virtual");
        const named = provider.getDeclarationModel(resolution, {
          context: {
            resolutionMode: "import",
            importSlice: {
              moduleSpecifier,
              kind: "named",
              requestedExports: [{ exportedName: "sum", kind: "value" }],
            },
          },
          materialization: { kind: "incremental", completeExports: [] },
        });
        assert.equal("exports" in named, true);
        assert.deepEqual(named.exports.map(({ name }) => name), ["sum"]);
        const closed = provider.getDeclarationModel(resolution, {
          context: {
            resolutionMode: "import",
            importSlice: {
              moduleSpecifier,
              kind: "named",
              requestedExports: [{ exportedName: "Counter", kind: "type" }],
            },
          },
          materialization: { kind: "incremental", completeExports: [] },
        });
        assert.deepEqual(closed.exports.map(({ name }) => name), ["Bucket", "Counter"]);
        const broad = provider.getDeclarationModel(resolution, {
          context: {
            resolutionMode: "import",
            importSlice: { moduleSpecifier, kind: "namespace", broadImport: true },
          },
          materialization: { kind: "incremental", completeExports: [] },
        });
        assert.equal(broad.extensionCode, "MOJO_COMPILER_PROVIDER_DECLARATION_FAILED");
        assert.match(broad.message, /BrokenAlias/u);
      } finally {
        session.close();
      }
    } finally {
      loader.close();
    }
  } finally {
    restoreEnvironment("TSONIC_MOJO_PROVIDER_BROKEN_EXPORT", previousBroken);
  }
});

test("compiler provider resolves public re-exports through exact language-server definitions", () => {
  const providerConfiguration = configuration();
  const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
  const package_ = snapshot.packages[0];
  const surface = package_.modules.find(({ modulePath }) => modulePath.join(".") === "surface");
  assert.ok(surface);
  const loader = createMojoCompilerMetadataLoader(
    join(repositoryRoot, ".temp", `compiler-provider-reexport-${process.pid}`),
  );
  try {
    const [resolved] = loader.resolveExports({
      snapshot,
      package: package_,
      module: surface,
      exportNames: ["PublicCounter"],
    });
    assert.equal(resolved.package.id, package_.id);
    assert.deepEqual(resolved.module.modulePath, ["api"]);
    assert.equal(resolved.declarationName, "Counter");
    const model = loader.module({
      snapshot,
      package: resolved.package,
      module: resolved.module,
      requestedExports: [resolved.declarationName],
    });
    const moduleSpecifier = mojoCompilerModuleSpecifier(package_, ["surface"]);
    const projection = projectMojoCompilerModule(snapshot, resolved.package, model, {
      providerModuleId: "fixture-probe:surface",
      moduleSpecifier,
      exports: [{ declarationName: "Counter", exportName: "PublicCounter" }],
    });
    assert.deepEqual(projection.declarationModel.exports.map(({ name, exportName }) =>
      [name, exportName]), [["Counter", "PublicCounter"]]);
    assert.equal(projection.types[0].targetType.name, "Counter");
    assert.deepEqual(projection.types[0].targetType.modulePath, ["probe", "api"]);
    assert.equal(projection.operations.every(({ exportId }) =>
      exportId === "fixture-probe:surface::export:PublicCounter"), true);
  } finally {
    loader.close();
  }
});

test("compiler export ownership and enumeration persist only for the exact snapshot", () => {
  const cacheRoot = join(repositoryRoot, ".temp", `compiler-provider-resolution-cache-${process.pid}`);
  const logPath = join(cacheRoot, "language-server.log");
  mkdirSync(cacheRoot, { recursive: true });
  const previousLog = process.env.TSONIC_MOJO_LSP_LOG;
  process.env.TSONIC_MOJO_LSP_LOG = logPath;
  try {
    const providerConfiguration = configuration();
    const snapshot = createMojoCompilerProjectSnapshot(providerConfiguration, "1.1.0.dev2026083005");
    const package_ = snapshot.packages[0];
    const api = package_.modules.find(({ modulePath }) => modulePath.join(".") === "api");
    const surface = package_.modules.find(({ modulePath }) => modulePath.join(".") === "surface");
    assert.ok(api);
    assert.ok(surface);

    for (let iteration = 0; iteration < 2; iteration += 1) {
      const loader = createMojoCompilerMetadataLoader(cacheRoot);
      try {
        assert.deepEqual(loader.listExports({ snapshot, package: package_, module: api }), [
          "Bucket",
          "Counter",
          "classify",
          "collect",
          "sum",
        ]);
        assert.equal(loader.resolveExports({
          snapshot,
          package: package_,
          module: surface,
          exportNames: ["PublicCounter"],
        })[0].declarationName, "Counter");
      } finally {
        loader.close();
      }
    }
    assert.equal(
      readFileSync(logPath, "utf8"),
      "exports\ndefinitions\n",
      "a second loader consumes exact snapshot-bound resolution records without LSP re-entry",
    );
  } finally {
    restoreEnvironment("TSONIC_MOJO_LSP_LOG", previousLog);
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
      genericParameters: [],
      parameters: [{
        convention: "imm",
        type: { kind: "named", name: "Int32", arguments: [] },
      }],
      result: { kind: "named", name: "String", arguments: [] },
      asynchronous: false,
      thin: true,
      raises: true,
      errorType: { kind: "named", name: "Error", arguments: [] },
    },
  );
  assert.deepEqual(
    parseMojoCompilerType(
      "def[mut: Bool, //, T: AnyType, width: Int = 4, *, origin: Origin](ref[a] value: T, var T) capturing[_] -> SIMD[.bool, width]",
      undefined,
    ),
    {
      kind: "function",
      genericParameters: [
        {
          kind: "value",
          name: "mut",
          passingKind: "inferred",
          variadic: false,
          constraints: [{ kind: "named", name: "Bool", arguments: [] }],
        },
        {
          kind: "type",
          name: "T",
          passingKind: "positional-or-keyword",
          variadic: false,
          constraints: [{ kind: "named", name: "AnyType", arguments: [] }],
        },
        {
          kind: "value",
          name: "width",
          passingKind: "positional-or-keyword",
          variadic: false,
          constraints: [{ kind: "named", name: "Int", arguments: [] }],
          defaultArgument: { kind: "value", expression: "4" },
        },
        {
          kind: "origin",
          name: "origin",
          passingKind: "keyword",
          variadic: false,
          constraints: [{ kind: "named", name: "Origin", arguments: [] }],
        },
      ],
      parameters: [
        {
          name: "value",
          convention: "ref",
          type: {
            kind: "reference",
            origin: "a",
            target: { kind: "type-parameter", name: "T" },
          },
        },
        {
          convention: "var",
          type: { kind: "type-parameter", name: "T" },
        },
      ],
      result: {
        kind: "named",
        name: "SIMD",
        arguments: [
          { kind: "value", expression: ".bool" },
          { kind: "value", expression: "width" },
        ],
      },
      asynchronous: false,
      thin: false,
      raises: false,
      capture: "_",
    },
  );
  assert.deepEqual(
    parseMojoCompilerType(
      "IterableType.IteratorType[iterable_is_mut, origin_of(iterable), origin_of(iterable)].Element",
      undefined,
      {
        typeParameters: new Set(["IterableType"]),
        valueParameters: new Set(["iterable_is_mut"]),
      },
    ),
    {
      kind: "associated",
      owner: {
        kind: "associated",
        owner: { kind: "type-parameter", name: "IterableType" },
        memberPath: ["IteratorType"],
        arguments: [
          { kind: "value", expression: "iterable_is_mut" },
          { kind: "value", expression: "origin_of(iterable)" },
          { kind: "value", expression: "origin_of(iterable)" },
        ],
      },
      memberPath: ["Element"],
      arguments: [],
    },
  );
  assert.throws(
    () => parseMojoCompilerType("External[Unclassified]", "/external/External"),
    /not classified by machine-readable metadata/u,
  );
});

test("compiler condition parser retains boolean, conditional, comparison, and predicate structure", () => {
  const scope = { typeParameters: new Set(["K", "T", "V"]) };
  assert.deepEqual(
    parseMojoCompilerConformanceCondition(
      "conforms_to(K, Copyable) and conforms_to(V, Copyable)",
      scope,
    ),
    {
      kind: "all",
      operands: [
        { kind: "conforms-to", subject: "K", traitNames: ["Copyable"] },
        { kind: "conforms-to", subject: "V", traitNames: ["Copyable"] },
      ],
    },
  );
  for (const condition of [
    "True if conforms_to(T, Copyable) else conforms_to(T, Copyable)",
    "conforms_to(T, Writable) and (address_space == AddressSpace.GENERIC)",
    "conforms_to(T, TrivialRegisterPassable) or T.__move_ctor_is_trivial if conforms_to(T, Movable) else conforms_to(T, Movable)",
    "TypeList.all_conforms_to[Writable]()",
    "not is_owned",
  ]) {
    assert.equal(Object.isFrozen(parseMojoCompilerConformanceCondition(condition, scope)), true);
  }
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
      const traitModel = first.module({ snapshot, package: package_, module: traits });
      assert.equal(traitModel.declarations.length, 4);
      const iterator = traitModel.declarations.find(({ name }) => name === "Iterator");
      assert.equal(iterator.aliases[0].abstract, true);
      assert.equal(iterator.aliases[0].targetType, undefined);
    } finally {
      first.close();
    }
    assert.equal(readFileSync(logPath, "utf8"), "doc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\n");

    const second = createMojoCompilerMetadataLoader(cacheRoot);
    try {
      assert.equal(second.module({ snapshot, package: package_, module: source }).functions[0].name, "sum");
    } finally {
      second.close();
    }
    assert.equal(
      readFileSync(logPath, "utf8"),
      "doc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\n",
      "the exact cached package document and classifications avoid compiler re-entry",
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
      "doc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\ndoc\n",
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
  assert.deepEqual(packagePlan.sources.map(({ path }) => path), [
    "__init__.mojo",
    "_private.mojo",
    "api.mojo",
    "surface/__init__.mojo",
    "traits.mojo",
  ]);
  assert.match(packagePlan.digest, /^[0-9a-f]{64}$/u);
  const output = materializeMojoOutputPlan({
    configuration: {
      packageName: "fixture",
      outputType: "bin",
      project: { kind: "generated" },
      compilerProvider: configuration(),
      toolchain: {
        kind: "pixi-mojo",
        compilerVersion: "1.1.0.dev2026083005",
        channels: ["conda-forge", "https://conda.modular.com/max-nightly/"],
        platforms: ["linux-64"],
        commandEnvironment: "posix",
      },
    },
    components: [{
      id: "fixture",
      packageName: "fixture",
      root: true,
      dependencies: [],
      artifactKey: "0".repeat(64),
    }],
    sources: [{
      componentId: "fixture",
      path: "src/main.mojo",
      module: { modulePath: [], imports: [], typeAliases: [], declarations: [] },
    }],
    runtimePackages: [packagePlan],
  });
  assert.deepEqual(
    output.artifacts.filter(({ path }) => path.startsWith("packages/")).map(({ path }) => path),
    [
      "packages/probe/__init__.mojo",
      "packages/probe/_private.mojo",
      "packages/probe/api.mojo",
      "packages/probe/surface/__init__.mojo",
      "packages/probe/traits.mojo",
    ],
  );
  const project = output.artifacts.find(({ path }) => path === "pixi.toml");
  assert.match(project.text, /-I 'packages'/u);
  assert.doesNotMatch(project.text, new RegExp(importRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
