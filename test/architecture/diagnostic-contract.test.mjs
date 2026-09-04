import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const contractPath = join(repositoryRoot, "test/fixtures/diagnostic-contract.tsv");
const contractText = readFileSync(contractPath, "utf8");
const contractLines = contractText.trimEnd().split("\n");
const baselineProductionCount = Number.parseInt(
  contractLines.find((line) => line.startsWith("# baselineProductionCount="))?.split("=")[1] ?? "",
  10,
);
const headerIndex = contractLines.findIndex((line) => !line.startsWith("#"));
const header = contractLines[headerIndex]?.split("\t") ?? [];
const rows = contractLines.slice(headerIndex + 1).map((line) => {
  const values = line.split("\t");
  return Object.fromEntries(header.map((name, index) => [name, values[index]]));
});

const allowedOwnerLayers = new Set([
  "analysis",
  "planning",
  "materialization",
  "provider",
  "runtime",
  "toolchain",
]);
const allowedClassifications = new Set([
  "invalid-source",
  "exact-rejection",
  "target-gap",
  "runtime-gap",
  "provider-gap",
  "pinned-toolchain-limit",
  "internal-invariant",
]);
const allowedAuditDispositions = new Set([
  "close-capability",
  "replace-runtime-umbrella",
  "retain-exact-guard",
  "eliminate-late-planning",
  "split-or-delete",
  "retain-generator-limit",
  "reviewed-other",
]);

test("every production Mojo diagnostic has one classified contract row", async () => {
  assert.deepEqual(header, [
    "code",
    "ownerLayer",
    "classification",
    "auditDisposition",
    "reachableSourceProof",
    "nativeProof",
    "mutationProof",
    "replacementCode",
  ]);
  assert.equal(Number.isSafeInteger(baselineProductionCount), true);
  assert.equal(baselineProductionCount, 609);

  const rowsByCode = new Map();
  for (const row of rows) {
    assert.match(row.code, /^MOJO_[A-Z0-9_]+$/u);
    assert.equal(rowsByCode.has(row.code), false, `duplicate diagnostic row '${row.code}'`);
    rowsByCode.set(row.code, row);
    assert.equal(allowedOwnerLayers.has(row.ownerLayer), true, `${row.code}: invalid owner layer`);
    assert.equal(
      allowedClassifications.has(row.classification),
      true,
      `${row.code}: invalid classification`,
    );
    assert.equal(
      allowedAuditDispositions.has(row.auditDisposition),
      true,
      `${row.code}: invalid audit disposition`,
    );
    for (const proofField of [
      "reachableSourceProof",
      "nativeProof",
      "mutationProof",
      "replacementCode",
    ]) {
      assert.equal(
        row[proofField] === "-" || row[proofField].length > 0,
        true,
        `${row.code}: empty ${proofField}`,
      );
    }
  }

  const productionCodes = new Set();
  for (const file of await sourceFiles(join(repositoryRoot, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const code of source.match(/MOJO_[A-Z0-9_]+/gu) ?? []) productionCodes.add(code);
  }
  assert.deepEqual([...rowsByCode.keys()].sort(), [...productionCodes].sort());
});

test("the explicit unsupported and native-limit baseline is dispositioned", () => {
  const explicitRows = rows.filter((row) =>
    /(?:UNSUPPORTED|NATIVE_LIMIT|NOT_IMPLEMENTED|UNAVAILABLE)/u.test(row.code));
  assert.equal(explicitRows.length, 116);
  assert.deepEqual(
    Object.fromEntries([...allowedAuditDispositions]
      .filter((disposition) => disposition !== "reviewed-other")
      .map((disposition) => [
        disposition,
        explicitRows.filter((row) => row.auditDisposition === disposition).length,
      ])),
    {
      "close-capability": 73,
      "replace-runtime-umbrella": 3,
      "retain-exact-guard": 19,
      "eliminate-late-planning": 8,
      "split-or-delete": 12,
      "retain-generator-limit": 1,
    },
  );
  assert.equal(explicitRows.some((row) => row.auditDisposition === "reviewed-other"), false);
});

test("diagnostic contract rows never use inferred or unknown classifications", () => {
  const forbidden = /unknown|inherited|filename|spelling|heuristic/iu;
  for (const row of rows) {
    assert.equal(forbidden.test(row.ownerLayer), false, `${row.code}: inferred owner`);
    assert.equal(forbidden.test(row.classification), false, `${row.code}: inferred classification`);
    assert.equal(forbidden.test(row.auditDisposition), false, `${row.code}: inferred disposition`);
  }
});

async function sourceFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path));
    else if (entry.isFile() && path.endsWith(".ts")) result.push(path);
  }
  return result.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}
