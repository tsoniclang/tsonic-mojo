import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { artifactTexts, compileMojo } from "../test/helpers/mojo-session.mjs";
import { memoryAbiCapability } from "../test/helpers/memory-abi.mjs";
import { nativeRecordProvider, nativeRecordSource } from "../test/helpers/native-record-provider.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, "../mojo-runtime");
const mojo = process.env.MOJO_BIN ?? join(runtime, ".pixi/envs/default/bin/mojo");
mkdirSync(join(root, ".temp"), { recursive: true });
const workspace = mkdtempSync(join(root, ".temp/native-memory-"));
const cases = [{
  name: "scalar", capabilities: [memoryAbiCapability()],
  source: `
import { abi } from "test:abi";
import { memoryLayout, addressOf, loadPointer, storePointer, toRawPointer, reinterpretRawPointer, unsafeContext, hashPointer, equalPointer, keepAlive } from "@tsonic/core/lang.js";
import type { uint32, Pointer } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
function pass(pointer: Pointer<uint32>): Pointer<uint32> { return pointer; }
function escaped(): Pointer<uint32> {
  unsafeContext();
  let values: uint32[] = [7, 8];
  const alias = values;
  const original = addressOf(alias[1]);
  const view = reinterpretRawPointer(toRawPointer(pass(original), word), word);
  if (view === undefined) throw new Error("missing view");
  storePointer(view, 19);
  if (values[1] !== 19 || !equalPointer(view, original) || hashPointer(view) !== hashPointer(original)) throw new Error("alias");
  values = [21, 22];
  if (loadPointer(view) !== 19 || values[1] !== 22) throw new Error("replacement");
  keepAlive(original);
  return view;
}
export function run(): boolean {
  const view = escaped();
  storePointer(view, 31);
  return loadPointer(view) === 31;
}
`,
  runner: `from std.testing import assert_true
from native_memory_proof import _initialize_tsonic_package, run
def main() raises:
    _initialize_tsonic_package()
    assert_true(run())
`,
}, {
  name: "record", capabilities: [memoryAbiCapability(), nativeRecordProvider()], source: nativeRecordSource,
  fixture: `@fieldwise_init
struct Header(Copyable):
    var kind: UInt8
    var amount: UInt32
`,
  runner: `from std.memory import ArcPointer
from std.testing import assert_equal
from tsonic_runtime import RawPointer
from native_record_fixture import Header
from native_memory_proof import _initialize_tsonic_package, update
def main() raises:
    _initialize_tsonic_package()
    var owner = ArcPointer(Header(3, 7))
    var raw = RawPointer.retained(owner, UInt(Int(owner.ptr())), 8)
    assert_equal(update(raw), 19)
    assert_equal(owner[].amount, 19)
`,
}];

const failures = [];
for (const proof of cases) {
  try {
    const output = join(workspace, proof.name);
    mkdirSync(output, { recursive: true });
    const result = compileMojo({ target: { id: "mojo", options: { packageName: "native_memory_proof", outputType: "lib" } },
      capabilities: proof.capabilities, files: { "index.ts": proof.source } });
    assert.deepEqual(result.diagnostics, []);
    for (const artifact of artifactTexts(result)) {
      const destination = resolve(output, artifact.path);
      const path = relative(output, destination);
      assert.ok(!path.startsWith("..") && !isAbsolute(path), `Artifact escapes output: ${artifact.path}`);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, artifact.text);
    }
    if (proof.fixture !== undefined) writeFileSync(join(output, "native_record_fixture.mojo"), proof.fixture);
    writeFileSync(join(output, "runner.mojo"), proof.runner);
    guarded(mojo, ["build", "-j", "1", "-I", join(output, "src"), "-I", output,
      "-I", join(runtime, "mojo"), join(output, "runner.mojo"), "-o", join(output, "proof")]);
    guarded(join(output, "proof"), []);
    process.stdout.write(`PASS native memory ${proof.name}\n`);
  } catch (error) {
    failures.push(`${proof.name}: ${error.stack ?? error}`);
  }
}
process.stdout.write(`Native memory: ${cases.length - failures.length}/${cases.length}; output: ${workspace}\n`);
if (failures.length !== 0) throw new Error(failures.join("\n\n"));

function guarded(command, arguments_) {
  const result = spawnSync("systemd-run", ["--user", "--quiet", "--wait", "--pipe", "--collect", `--setenv=PATH=${process.env.PATH}`,
    `--setenv=MODULAR_HOME=${process.env.MODULAR_HOME ?? join(runtime, ".pixi/envs/default/share/max")}`,
    "--setenv=MODULAR_CRASH_REPORTING_ENABLED=0",
    "-p", "MemoryMax=6G", "-p", "MemorySwapMax=0", "-p", "TasksMax=256", "-p", "LimitCORE=0", "-p", "RuntimeMaxSec=240",
    command, ...arguments_], { cwd: root, stdio: "inherit", timeout: 270_000, killSignal: "SIGKILL" });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.signal ?? result.status}`);
}
