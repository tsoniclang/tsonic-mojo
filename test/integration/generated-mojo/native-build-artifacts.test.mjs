import assert from "node:assert/strict";
import test from "node:test";
import { materializeMojoOutputPlan } from "../../../dist/backend/emission/materialize.js";

function outputPlan(outputType) {
  return {
    configuration: {
      packageName: "native_fixture",
      outputType,
      project: { kind: "generated" },
      compilerProvider: { command: { executable: "mojo", arguments: [], workingDirectory: process.cwd() } },
      toolchain: {
        kind: "pixi-mojo",
        compilerVersion: "1.0.0",
        channels: ["conda-forge", "https://conda.modular.com/max/"],
        platforms: ["linux-64"],
        commandEnvironment: "posix",
        cCompiler: { environmentVariable: "CONDA_PREFIX", path: "bin/gcc" },
        cxxCompiler: { environmentVariable: "CONDA_PREFIX", path: "bin/g++" },
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
        sourceIncludeDirectories: ["packages/.native/native_runtime/include"],
        translationUnits: [{
          language: "c",
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
    schemaVersion: 4,
    toolchain: {
      kind: "pixi-mojo",
      compilerVersion: "1.0.0",
      channels: ["conda-forge", "https://conda.modular.com/max/"],
      platforms: ["linux-64"],
      commandEnvironment: "posix",
      cCompiler: { environmentVariable: "CONDA_PREFIX", path: "bin/gcc" },
      cxxCompiler: { environmentVariable: "CONDA_PREFIX", path: "bin/g++" },
    },
    components: [{
      id: "native-fixture", packageName: "native_fixture", root: true,
      artifactKey: "0".repeat(64), dependencies: [], kind: "library",
      sourcePath: "src/native_fixture", artifactPath: "build/native_fixture.mojoc",
      includeDirectories: ["src"],
    }],
    dependencies: [{ name: "example-native", version: "==1.0.0" }],
    packages: [{
      packageName: "native_runtime",
      digest: "1".repeat(64),
      includeDirectories: ["include/example"],
      sourceIncludeDirectories: ["packages/.native/native_runtime/include"],
      translationUnits: [{
        language: "c",
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

test("user-owned projects receive the same complete native component contract without a Pixi project", () => {
  const plan = outputPlan("lib");
  plan.configuration.project = { kind: "user-owned", manifestPath: "/workspace/pixi.toml" };
  plan.nativeBuild = { dependencies: [], packages: [], staticLibraries: [], dynamicLibraries: [] };
  const artifacts = materializeMojoOutputPlan(plan).artifacts;
  assert.equal(artifacts.some(({ path }) => path === "pixi.toml"), false);
  const manifest = JSON.parse(artifacts.find(({ path }) => path === "mojo-native-build.json").text);
  assert.equal(manifest.components[0].sourcePath, "src/native_fixture");
  assert.equal(manifest.components[0].artifactPath, "build/native_fixture.mojoc");
  assert.deepEqual(manifest.packages, []);
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

test("native runtime units select the pinned compiler for their exact language", () => {
  const plan = outputPlan("bin");
  plan.nativeBuild.packages[0].translationUnits.push({
    language: "c++", standard: "c++17",
    sourcePath: "packages/.native/native_runtime/numeric.cpp",
    objectPath: "build/native/native_runtime/numeric.o",
  });
  const output = materializeMojoOutputPlan(plan);
  const project = output.artifacts.find(({ path }) => path === "pixi.toml").text;
  assert.ok(project.includes('\\"$CONDA_PREFIX/bin/gcc\\" -O3 -fPIC -std=c11'));
  assert.ok(project.includes('\\"$CONDA_PREFIX/bin/g++\\" -O3 -fPIC -std=c++17'));
  assert.ok(project.includes('\\"$CONDA_PREFIX/include/example\\"'));
  assert.ok(project.includes("-I'packages/.native/native_runtime/include'"));
  assert.ok(!project.includes("$CONDA_PREFIX/packages/.native"));
  assert.ok(project.includes("-Xlinker 'build/native/native_runtime/numeric.o'"));
  const manifest = JSON.parse(output.artifacts.find(({ path }) => path === "mojo-native-build.json").text);
  assert.deepEqual(manifest.packages[0].translationUnits.map(({ language, standard }) => [language, standard]), [
    ["c", "c11"], ["c++", "c++17"],
  ]);
});

test("native text assets publish byte-for-byte beside their translation units", () => {
  const plan = outputPlan("lib");
  const header = "\ufeff#define NATIVE_VALUE 42\r\n";
  plan.runtimePackages.push({
    packageName: "native_runtime", sources: [],
    native: {
      translationUnits: [{ path: "native.c", text: '#include "include/value.h"\n' }],
      assets: [{ path: "include/value.h", text: header }],
    },
  });
  const assets = materializeMojoOutputPlan(plan).artifacts.filter(({ kind }) => kind === "asset");
  assert.deepEqual(assets.map(({ path }) => path), [
    "packages/.native/native_runtime/native.c",
    "packages/.native/native_runtime/include/value.h",
  ]);
  assert.deepEqual(Buffer.from(assets[1].text, "utf8"), Buffer.from(header, "utf8"));
});
