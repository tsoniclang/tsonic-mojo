import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const contract = readJson("test/fixtures/parity-contract.json");

const allowedClassifications = new Set([
  "implemented-native",
  "implemented-generated",
  "shared-intentional-rejection",
  "target-implementation-gap",
  "runtime-library-gap",
  "provider-metadata-gap",
  "pinned-toolchain-limit",
  "deliberately-deferred",
]);

const implementedClassifications = new Set([
  "implemented-native",
  "implemented-generated",
]);

test("Mojo parity benchmark is an exact immutable snapshot of the mature target", () => {
  assert.equal(contract.contractVersion, 2);
  assert.match(contract.benchmark.commit, /^[0-9a-f]{40}$/u);
  assertBenchmarkSnapshot(contract.benchmark.languageInventory);
  assertBenchmarkSnapshot(contract.benchmark.javascriptNodeInventory);

  const languageBenchmark = readJson(contract.benchmark.languageInventory.snapshotPath);
  const javascriptNodeBenchmark = readJson(contract.benchmark.javascriptNodeInventory.snapshotPath);
  assert.equal(languageBenchmark.length, 61);
  assert.equal(javascriptNodeBenchmark.length, 155);
  assert.deepEqual(
    contract.language.map((row) => row.id),
    languageBenchmark.map((row) => row.id),
  );
  assert.deepEqual(
    contract.javascriptNode.map((row) => row.lane),
    javascriptNodeBenchmark.map((row) => row.lane),
  );
  for (const [index, benchmark] of languageBenchmark.entries()) {
    const row = contract.language[index];
    assert.equal(row.benchmarkClassification, benchmark.classification, row.id);
    assert.equal(row.benchmarkAction, benchmark.action, row.id);
  }
  for (const [index, benchmark] of javascriptNodeBenchmark.entries()) {
    const row = contract.javascriptNode[index];
    assert.equal(row.benchmarkClassification, benchmark.classification, row.id);
    assert.equal(row.benchmarkReason, benchmark.reason, row.id);
  }
});

test("Mojo parity inventory preserves every language capability area", () => {
  assert.equal(contract.language.length, 61);
  assertInventory(contract.language, [
    "modules",
    "declarations",
    "objects",
    "bindings",
    "control-flow",
    "iteration",
    "generators",
    "resources",
    "expressions",
    "types",
    "safety",
    "providers",
    "surfaces",
    "output",
  ]);
});

test("Mojo parity inventory preserves every JavaScript and Node capability area", () => {
  assert.equal(contract.javascriptNode.length, 155);
  assertInventory(contract.javascriptNode, [
    "Array",
    "String",
    "Math",
    "JSON",
    "Map",
    "Set",
    "Date",
    "RegExp",
    "Reflection",
    "Object",
    "Number",
    "Boolean",
    "console",
    "Unions",
    "Arrays",
    "Node",
  ]);
});

test("implemented parity rows carry executable source, analysis, and output proofs", () => {
  for (const row of allRows()) {
    if (!implementedClassifications.has(row.classification)) continue;
    assertProof(row, "sourceProof");
    assertProof(row, "analysisProof");
    assertProof(row, "emissionProof");
    assert.equal(
      row.nativeProof !== undefined || row.runtimeProof !== undefined,
      true,
      `${row.id}: implemented rows require a native or runtime proof`,
    );
  }
});

test("rejections and open gaps identify their exact executable boundary", () => {
  for (const row of allRows()) {
    if (implementedClassifications.has(row.classification)) continue;
    assertProof(row, "sourceProof");
    assertProof(row, "analysisProof");
    assertProof(row, "boundaryProof");
    assert.equal(typeof row.note, "string", `${row.id}: open rows require an exact reason`);
    assert.notEqual(row.note.length, 0, `${row.id}: open rows require an exact reason`);
    if (row.classification === "shared-intentional-rejection") {
      assertProof(row, "mutationProof");
    }
    if (row.classification === "pinned-toolchain-limit") {
      assertProof(row, "nativeProof");
    }
  }
});

test("the accepted implementation plan leaves no unowned target implementation gap", () => {
  assert.deepEqual(
    allRows().filter((row) => row.classification === "target-implementation-gap"),
    [],
  );
});

function assertInventory(rows, requiredAreas) {
  const identities = new Set();
  const proofIdentities = new Set();
  const areas = new Set();
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.notEqual(row.id.length, 0);
    assert.equal(identities.has(row.id), false, `duplicate parity lane '${row.id}'`);
    identities.add(row.id);
    areas.add(row.area);
    assert.equal(row.proofId, row.id, `${row.id}: proof identity must equal lane identity`);
    assert.equal(proofIdentities.has(row.proofId), false, `duplicate proof identity '${row.proofId}'`);
    proofIdentities.add(row.proofId);
    assert.equal(
      allowedClassifications.has(row.classification),
      true,
      `${row.id}: invalid classification '${row.classification}'`,
    );
    assert.equal("status" in row, false, `${row.id}: stale status vocabulary remains`);
    assert.equal("proof" in row, false, `${row.id}: untyped proof path remains`);
    for (const [field, value] of Object.entries(row)) {
      if (!field.endsWith("Proof")) continue;
      assert.equal(typeof value, "string", `${row.id}: ${field} must be a path`);
      assert.equal(
        existsSync(join(repositoryRoot, value)),
        true,
        `${row.id}: missing ${field} '${value}'`,
      );
    }
  }
  for (const area of requiredAreas) {
    assert.equal(areas.has(area), true, `missing parity area '${area}'`);
  }
}

function assertBenchmarkSnapshot(inventory) {
  assert.equal(typeof inventory.path, "string");
  assert.equal(typeof inventory.snapshotPath, "string");
  assert.match(inventory.sha256, /^[0-9a-f]{64}$/u);
  const path = join(repositoryRoot, inventory.snapshotPath);
  const bytes = readFileSync(path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), inventory.sha256);
  assert.equal(JSON.parse(bytes).length, inventory.rowCount);
}

function assertProof(row, field) {
  assert.equal(typeof row[field], "string", `${row.id}: missing ${field}`);
  assert.equal(
    existsSync(join(repositoryRoot, row[field])),
    true,
    `${row.id}: missing ${field} '${row[field]}'`,
  );
}

function allRows() {
  return [...contract.language, ...contract.javascriptNode];
}

function readJson(path) {
  return JSON.parse(readFileSync(join(repositoryRoot, path), "utf8"));
}
