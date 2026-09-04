import assert from "node:assert/strict";
import test from "node:test";
import { materializeMojoOutputPlan } from "../../../dist/backend/emission/materialize.js";

function outputPlan(outputType) {
  return {
    configuration: {
      packageName: "native_fixture",
      outputType,
      project: { kind: "generated" },
      compilerProvider: {},
      toolchain: {
        kind: "pixi-mojo",
        compilerVersion: "1.1.0.dev2026083005",
        channels: ["conda-forge", "https://conda.modular.com/max-nightly/"],
        platforms: ["linux-64"],
        commandEnvironment: "posix",
        cCompiler: "cc",
      },
    },
    components: [{
      id: "native-fixture",
      packageName: "native_fixture",
      root: true,
      dependencies: [],
      artifactKey: "0".repeat(64),
    }],
    sources: [{
      componentId: "native-fixture",
      path: outputType === "bin" ? "src/main.mojo" : "src/native_fixture/__init__.mojo",
      module: { modulePath: [], imports: [], typeAliases: [], declarations: [] },
    }],
    runtimePackages: [],
    nativeBuild: {
      dependencies: [{ name: "example-native", version: "==1.0.0" }],
      packages: [{
        packageName: "native_runtime",
        digest: "1".repeat(64),
        includeDirectories: ["include/example"],
        translationUnits: [{
          sourcePath: "packages/.native/native_runtime/native.c",
          objectPath: "build/native/native_runtime/native.o",
          standard: "c11",
        }],
      }],
      staticLibraries: ["lib/libexample.a"],
      dynamicLibraries: ["pthread"],
    },
  };
}

test("library precompilation publishes native link inputs without passing linker flags", () => {
  const output = materializeMojoOutputPlan(outputPlan("lib"));
  const project = output.artifacts.find(({ path }) => path === "pixi.toml");
  const native = output.artifacts.find(({ path }) => path === "mojo-native-build.json");
  assert.ok(project);
  assert.ok(native);
  assert.match(project.text, /mojo precompile/u);
  assert.doesNotMatch(project.text, /mojo precompile[^\n]*-Xlinker/u);
  assert.deepEqual(JSON.parse(native.text), {
    schemaVersion: 1,
    toolchain: {
      kind: "pixi-mojo",
      compilerVersion: "1.1.0.dev2026083005",
      channels: ["conda-forge", "https://conda.modular.com/max-nightly/"],
      platforms: ["linux-64"],
      commandEnvironment: "posix",
      cCompiler: "cc",
    },
    dependencies: [{ name: "example-native", version: "==1.0.0" }],
    packages: [{
      packageName: "native_runtime",
      digest: "1".repeat(64),
      includeDirectories: ["include/example"],
      translationUnits: [{
        sourcePath: "packages/.native/native_runtime/native.c",
        objectPath: "build/native/native_runtime/native.o",
        standard: "c11",
      }],
    }],
    libraryDirectories: [{ environmentVariable: "CONDA_PREFIX", path: "lib" }],
    staticLibraries: [{ environmentVariable: "CONDA_PREFIX", path: "lib/libexample.a" }],
    dynamicLibraries: ["pthread"],
  });
});

test("binary builds consume the same native inputs at their final link", () => {
  const output = materializeMojoOutputPlan(outputPlan("bin"));
  const project = output.artifacts.find(({ path }) => path === "pixi.toml");
  assert.ok(project);
  assert.match(project.text, /mojo build[^\n]*-Xlinker 'build\/native\/native_runtime\/native\.o'/u);
  assert.match(project.text, /-Xlinker \\"\$CONDA_PREFIX\/lib\/libexample\.a\\"/u);
  assert.match(project.text, /-Xlinker -L\\"\$CONDA_PREFIX\/lib\\"/u);
  assert.match(project.text, /-Xlinker -lpthread/u);
});
