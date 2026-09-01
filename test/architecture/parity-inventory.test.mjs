import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const contract = JSON.parse(readFileSync(
  join(repositoryRoot, "test/fixtures/parity-contract.json"),
  "utf8",
));

const allowedStatuses = new Set([
  "pending",
  "partial",
  "matched",
  "matched-rejection",
  "mojo-limit",
]);

test("Mojo parity inventory preserves every mature-target language lane", () => {
  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.language.length, 61);
  assert.equal(contract.benchmark.languageInventory.rowCount, 61);
  assert.match(contract.benchmark.commit, /^[0-9a-f]{40}$/u);
  assert.match(contract.benchmark.languageInventory.sha256, /^[0-9a-f]{64}$/u);
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

test("Mojo parity inventory preserves every mature-target JavaScript and Node lane", () => {
  assert.equal(contract.javascriptNode.length, 153);
  assert.equal(contract.benchmark.javascriptNodeInventory.rowCount, 153);
  assert.match(contract.benchmark.javascriptNodeInventory.sha256, /^[0-9a-f]{64}$/u);
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

function assertInventory(rows, requiredAreas) {
  const identities = new Set();
  const areas = new Set();
  for (const row of rows) {
    assert.equal(typeof row.id, "string");
    assert.notEqual(row.id.length, 0);
    assert.equal(identities.has(row.id), false, `duplicate parity lane '${row.id}'`);
    identities.add(row.id);
    areas.add(row.area);
    assert.equal(allowedStatuses.has(row.status), true, `${row.id}: invalid status '${row.status}'`);
    if (row.status === "partial") {
      assert.equal(typeof row.note, "string", `${row.id}: partial rows require an exact note`);
      assert.notEqual(row.note.length, 0);
    }
    if (row.status === "matched" || row.status === "matched-rejection") {
      assert.equal(typeof row.proof, "string", `${row.id}: matched rows require a proof`);
      assert.equal(existsSync(join(repositoryRoot, row.proof)), true, `${row.id}: missing proof '${row.proof}'`);
    }
    if (row.status === "mojo-limit") {
      assert.equal(typeof row.note, "string", `${row.id}: Mojo limits require a reason`);
      assert.notEqual(row.note.length, 0);
    }
  }
  for (const area of requiredAreas) {
    assert.equal(areas.has(area), true, `missing parity area '${area}'`);
  }
}
