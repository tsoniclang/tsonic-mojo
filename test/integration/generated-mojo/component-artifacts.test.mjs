import assert from "node:assert/strict";
import test from "node:test";
import { compileMojo } from "../../helpers/mojo-session.mjs";

test("source-package components compile once behind content-addressed Mojo artifacts", () => {
  const rootPackage = Object.freeze({
    id: "root-package",
    name: "root",
    packageRoot: "/src",
    sourceRoot: "/src",
    sourceFiles: Object.freeze(["/src/index.ts"]),
    dependencies: Object.freeze(["dependency-package"]),
    exports: Object.freeze([{ specifier: ".", sourceFile: "/src/index.ts" }]),
    componentId: "root-component",
  });
  const dependencyPackage = Object.freeze({
    id: "dependency-package",
    name: "dependency",
    packageRoot: "/src/dependency",
    sourceRoot: "/src/dependency",
    sourceFiles: Object.freeze(["/src/dependency/index.ts"]),
    dependencies: Object.freeze([]),
    exports: Object.freeze([{ specifier: ".", sourceFile: "/src/dependency/index.ts" }]),
    componentId: "dependency-component",
  });
  const result = compileMojo({
    files: {
      "index.ts": "import { value } from './dependency/index.js'; export function main(): void { value(); }",
      "dependency/index.ts": "export function value(): void {}",
    },
    sourcePackages: Object.freeze({
      fingerprint: "component-fixture",
      rootPackageId: rootPackage.id,
      packages: Object.freeze([rootPackage, dependencyPackage]),
      components: Object.freeze([
        Object.freeze({
          id: "root-component",
          packages: Object.freeze([rootPackage.id]),
          dependencies: Object.freeze(["dependency-component"]),
        }),
        Object.freeze({
          id: "dependency-component",
          packages: Object.freeze([dependencyPackage.id]),
          dependencies: Object.freeze([]),
        }),
      ]),
    }),
  });
  assert.deepEqual(result.diagnostics, []);
  const paths = result.artifacts.map(({ path }) => path);
  const dependencySource = paths.find((path) =>
    /^components\/tsonic_dep_[0-9a-f]+\/src\/tsonic_dep_[0-9a-f]+\/__init__\.mojo$/u.test(path));
  assert.ok(dependencySource);
  assert.ok(paths.includes("src/tsonic_generated/__init__.mojo"));
  const project = result.artifacts.find(({ path }) => path === "pixi.toml");
  assert.ok(project);
  assert.match(project.text, /mojo precompile/u);
  assert.match(project.text, /build\/components\/[0-9a-f]{64}\/tsonic_dep_[0-9a-f]+\.mojoc/u);
  assert.match(project.text, /depends-on = \["build_tsonic_dep_[0-9a-f]+"\]/u);
  assert.doesNotMatch(project.text, /-I 'components\/tsonic_dep_/u);
});
