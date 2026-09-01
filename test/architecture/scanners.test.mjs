import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

test("planning and emission depend only on sealed target syntax and queries", async () => {
  const files = await sourceFiles(join(repoRoot, "src/backend"));
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [
      /sourceFacts/u,
      /\.semantics\b/u,
      /providers\/packages/u,
      /compilation\/session/u,
      /getChecker|checker\./u,
    ]) {
      if (pattern.test(text)) violations.push(`${relative(repoRoot, file)}: ${pattern.source}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("target-model and policy preserve the target dependency direction", async () => {
  const violations = [];
  for (const [directory, forbidden] of [
    ["src/target-model", ["/analysis/", "/backend/", "/compilation/", "/policy/", "/providers/"]],
    ["src/policy", ["/analysis/", "/backend/", "/compilation/"]],
    ["src/analysis", ["/backend/"]],
  ]) {
    for (const file of await sourceFiles(join(repoRoot, directory))) {
      const text = readFileSync(file, "utf8");
      for (const fragment of forbidden) {
        if (text.includes(fragment)) {
          violations.push(`${relative(repoRoot, file)}: ${fragment}`);
        }
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Mojo uses the shared sealed target-program boundary", () => {
  const model = readFileSync(join(repoRoot, "src/analysis/program/model.ts"), "utf8");
  const construction = readFileSync(
    join(repoRoot, "src/analysis/program/analyze.ts"),
    "utf8",
  );
  const queries = readFileSync(join(repoRoot, "src/analysis/program/queries.ts"), "utf8");
  for (const field of ["host", "source", "sourceNavigation", "sourceFiles"]) {
    assert.match(model, new RegExp(`readonly ${field}:`, "u"));
  }
  assert.match(construction, /snapshotTargetPlanningSourceNavigation\(input\.source\)/u);
  assert.doesNotMatch(queries, /TargetCompileInput\["source"\]|source\.navigation/u);
});

test("planner and target AST use the shared domain structure", () => {
  for (const path of [
    "src/backend/artifact-model/project",
    "src/backend/planner/bindings",
    "src/backend/planner/declarations",
    "src/backend/planner/expressions",
    "src/backend/planner/objects",
    "src/backend/planner/program",
    "src/backend/planner/statements",
    "src/backend/planner/types",
    "src/backend/target-ast/declarations.ts",
    "src/backend/target-ast/expressions.ts",
    "src/backend/target-ast/imports.ts",
    "src/backend/target-ast/modules.ts",
    "src/backend/target-ast/statements.ts",
    "src/print/project",
    "src/print/source",
  ]) {
    assert.equal(existsSync(join(repoRoot, path)), true, `missing canonical layer '${path}'`);
  }
  for (const path of [
    "src/backend/planner/program.ts",
    "src/backend/planner/expressions.ts",
    "src/backend/planner/statements.ts",
    "src/backend/target-ast/nodes.ts",
    "src/backend/emission/printer.ts",
  ]) {
    assert.equal(existsSync(join(repoRoot, path)), false, `obsolete flat module '${path}'`);
  }
});

test("physical provider filenames do not classify project source", () => {
  const analysis = readFileSync(
    join(repoRoot, "src/analysis/program/analyze.ts"),
    "utf8",
  );
  assert.doesNotMatch(analysis, /tsts-provider:\/\//u);
  assert.match(analysis, /!ast\.isDeclarationFile\(sourceFile\)/u);
});

test("target source modules remain structurally bounded", async () => {
  const files = await sourceFiles(join(repoRoot, "src"));
  const oversized = files.flatMap((file) => {
    const lineCount = readFileSync(file, "utf8").split("\n").length;
    return lineCount > 600 ? [`${relative(repoRoot, file)}: ${lineCount}`] : [];
  });
  assert.deepEqual(oversized, []);
});

async function sourceFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) result.push(path);
  }
  return result.sort();
}
