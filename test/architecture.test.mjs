import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

test("physical provider filenames do not classify project source", () => {
  const analysis = readFileSync(
    join(repoRoot, "src/analysis/program/target-program.ts"),
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
