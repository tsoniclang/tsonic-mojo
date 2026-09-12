import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { artifactTexts, compileMojo } from "../test/helpers/mojo-session.mjs";
import { associatedNative, associatedProvider, associatedSource, borrowedNative, borrowedProvider, borrowedSource, foreignNative, foreignProvider, foreignSource } from "../test/helpers/native-interop-provider.mjs";
import { verifyCompilerMetadata } from "./native-interop/compiler-metadata.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, "../mojo-runtime");
const mojo = process.env.MOJO_BIN ?? join(runtime, ".pixi/envs/default/bin/mojo");
mkdirSync(join(root, ".temp"), { recursive: true });
const workspace = mkdtempSync(join(root, ".temp/native-interop-"));
const cases = [{
  name: "c-abi", capabilities: [foreignProvider()], source: foreignSource, c: foreignNative,
  runner: `from std.testing import assert_true
from native_interop_proof import run, _initialize_tsonic_package
def main() raises:
    _initialize_tsonic_package()
    assert_true(run())
`,
}, {
  name: "borrowed-identity", capabilities: [borrowedProvider()], source: borrowedSource,
  fixtures: { "native_borrow.mojo": borrowedNative },
  runner: `from std.memory import Pointer
from std.testing import assert_equal
from native_borrow import View
from native_interop_proof import relay, relay_view
def main() raises:
    var value = Int32(7)
    ref selected_value = relay[origin_of(value)](value)
    assert_equal(selected_value, 7)
    assert_equal(Int(Pointer(to=selected_value)), Int(Pointer(to=value)))
    var view = View[origin_of(value)](Pointer(to=value))
    ref selected = relay_view[origin_of(value)](view)
    assert_equal(Int(Pointer(to=selected)), Int(Pointer(to=value)))
`,
}, {
  name: "associated-result", capabilities: [associatedProvider()], source: associatedSource,
  fixtures: { "native_associated.mojo": associatedNative },
  runner: `from std.testing import assert_equal
from native_interop_proof import run
def main() raises:
    assert_equal(run(), 37)
`,
}, {
  name: "borrowed-escape", capabilities: [borrowedProvider()], source: borrowedSource,
  fixtures: { "native_borrow.mojo": borrowedNative },
  runner: `from native_interop_proof import relay
def invalid[O: Origin](ref[O] value: Int32) -> ref[O] Int32:
    var local = Int32(7)
    return relay[origin_of(local)](local)
def main():
    var value = Int32(8)
    _ = invalid[origin_of(value)](value)
`,
  rejection: /cannot return reference with incompatible origin/u,
}];
const failures = [];
try {
  verifyCompilerMetadata(workspace, mojo, guarded);
  process.stdout.write("PASS native interop compiler-metadata\n");
} catch (error) {
  failures.push(`compiler-metadata: ${error.stack ?? error}`);
}
for (const proof of cases) {
  try {
    const output = join(workspace, proof.name);
    mkdirSync(output, { recursive: true });
    const result = compileMojo({ target: { id: "mojo", options: { packageName: "native_interop_proof", outputType: "lib" } },
      capabilities: proof.capabilities, files: { "index.ts": proof.source } });
    assert.deepEqual(result.diagnostics, []);
    for (const artifact of artifactTexts(result)) {
      const destination = resolve(output, artifact.path);
      const path = relative(output, destination);
      assert.ok(!path.startsWith("..") && !isAbsolute(path), `Artifact escapes output: ${artifact.path}`);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, artifact.text);
    }
    for (const [name, contents] of Object.entries(proof.fixtures ?? {})) writeFileSync(join(output, name), contents);
    const link = [];
    if (proof.c !== undefined) {
      writeFileSync(join(output, "fixture.c"), proof.c);
      guarded(process.env.CC ?? "cc", ["-std=c11", "-Werror", "-Wall", "-Wextra", "-c", join(output, "fixture.c"), "-o", join(output, "fixture.o")]);
      link.push("-Xlinker", join(output, "fixture.o"));
    }
    writeFileSync(join(output, "runner.mojo"), proof.runner);
    const compiled = guarded(mojo, ["build", "-j", "1", "-I", join(output, "src"), "-I", output,
      "-I", join(runtime, "mojo"), ...link, join(output, "runner.mojo"), "-o", join(output, "proof")], proof.rejection !== undefined);
    if (proof.rejection !== undefined) {
      assert.equal(compiled.status, 1, "borrow rejection must be a diagnostic, not a compiler crash");
      assert.match(compiled.stderr, proof.rejection);
      assert.doesNotMatch(compiled.stderr, /Stack dump|Assertion.*failed|LLVM ERROR|unknown declaration|unexpected token/u);
    } else guarded(join(output, "proof"), []);
    process.stdout.write(`PASS native interop ${proof.name}\n`);
  } catch (error) {
    failures.push(`${proof.name}: ${error.stack ?? error}`);
  }
}
process.stdout.write(`Native interop: ${cases.length + 1 - failures.length}/${cases.length + 1}; output: ${workspace}\n`);
if (failures.length !== 0) throw new Error(failures.join("\n\n"));

function guarded(command, arguments_, expectedRejection = false) {
  const result = spawnSync("systemd-run", ["--user", "--quiet", "--wait", "--pipe", "--collect", `--setenv=PATH=${process.env.PATH}`,
    `--setenv=MODULAR_HOME=${process.env.MODULAR_HOME ?? join(runtime, ".pixi/envs/default/share/max")}`,
    "--setenv=MODULAR_CRASH_REPORTING_ENABLED=0",
    "-p", "MemoryMax=6G", "-p", "MemorySwapMax=0", "-p", "TasksMax=256", "-p", "LimitCORE=0", "-p", "RuntimeMaxSec=240",
    command, ...arguments_], { cwd: root, encoding: "utf8", timeout: 270_000, maxBuffer: 8 * 1024 * 1024, killSignal: "SIGKILL" });
  if (result.error !== undefined) throw result.error;
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (!expectedRejection) assert.equal(result.status, 0, `${command} failed: ${result.signal ?? result.status}`);
  return result;
}
