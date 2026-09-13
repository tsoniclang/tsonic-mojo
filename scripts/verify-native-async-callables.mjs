import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { artifactTexts, compileMojo } from "../test/helpers/mojo-session.mjs";
import { declarationFactorySource, defaultArgumentsFactorySource, emptyFactorySource, retainedFactorySource, ownedCallbackSource, nestedStringSource, throwingFactorySource } from "../test/helpers/async-callables.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtime = resolve(root, "../mojo-runtime");
const mojo = process.env.MOJO_BIN ?? join(runtime, ".pixi/envs/default/bin/mojo");
mkdirSync(join(root, ".temp"), { recursive: true });
const workspace = mkdtempSync(join(root, ".temp/native-async-callables-"));
const cases = [{
  name: "nested-string-awaits", source: nestedStringSource,
  runner: `from std.testing import assert_equal
from tsonic_runtime import create_task
from native_async_proof import message
def main() raises:
    assert_equal(create_task(message()).wait(), "hello")
`,
}, {
  name: "declaration-invocations", source: declarationFactorySource,
  runner: `from std.testing import assert_equal, assert_true
from tsonic_runtime import ClosedRaisingCoroutine, create_raising_task
from native_async_proof import _initialize_tsonic_package, callback, method, same
def escaped() raises -> ClosedRaisingCoroutine[String]:
    var selected = callback()
    var value = String("retained argument")
    return selected.call((value^,))
def main() raises:
    _initialize_tsonic_package()
    assert_true(same())
    assert_equal(create_raising_task(escaped()).wait(), "retained argument")
    var selected = method()
    assert_equal(create_raising_task(selected.call((String("static argument"),))).wait(), "static argument")
`,
}, {
  name: "escaped-invocations", source: retainedFactorySource,
  runner: `from std.testing import assert_equal
from tsonic_runtime import ClosedRaisingCoroutine, create_raising_task
from native_async_proof import retained
def escaped() raises -> ClosedRaisingCoroutine[Float64]:
    var callback = retained(10.0)
    var first = callback.call((2.0,))
    assert_equal(create_raising_task(first^).wait(), 12.0)
    return callback.call((3.0,))
def main() raises:
    assert_equal(create_raising_task(escaped()).wait(), 15.0)
`,
}, {
  name: "default-and-rest-arguments", source: defaultArgumentsFactorySource,
  runner: `from std.collections import List, Optional
from std.testing import assert_equal
from tsonic_runtime import ClosedRaisingCoroutine, create_raising_task
from native_async_proof import create
def escaped() raises -> ClosedRaisingCoroutine[String]:
    var callback = create("prefix:")
    var tail: List[String] = ["first", "second"]
    return callback.call((Optional[String](), tail^))
def main() raises:
    assert_equal(create_raising_task(escaped()).wait(), "prefix:default")
    var callback = create("prefix:")
    var tail: List[String] = ["first", "second"]
    assert_equal(create_raising_task(callback.call((Optional[String]("chosen"), tail^))).wait(), "prefix:chosen")
    assert_equal(create_raising_task(callback.call((Optional[String](), List[String]()))).wait(), "prefix:")
`,
}, {
  name: "empty-arguments", source: emptyFactorySource,
  runner: `from std.testing import assert_equal
from tsonic_runtime import create_raising_task
from native_async_proof import empty
def main() raises:
    var callback = empty()
    assert_equal(create_raising_task(callback.call(())).wait(), 11.0)
`,
}, {
  name: "deferred-errors", source: throwingFactorySource,
  runner: `from std.testing import assert_equal, assert_true
from tsonic_runtime import ClosedRaisingCoroutine, create_raising_task
from native_async_proof import rejecting
def escaped() raises -> ClosedRaisingCoroutine[Float64]:
    var callback = rejecting()
    return callback.call((-1.0,))
def main() raises:
    var failed = False
    var pending = escaped()
    try:
        _ = create_raising_task(pending^).wait()
    except error:
        assert_equal(String(error), "negative step")
        failed = True
    assert_true(failed)
`,
}, {
  name: "native-nested-awaits", source: ownedCallbackSource,
  runner: `from std.testing import assert_true
from tsonic_runtime import create_raising_task
from native_async_proof import run
def main() raises:
    assert_true(create_raising_task(run()).wait())
`,
}];

const failures = [];
let generated = 0;
let executed = 0;
for (const proof of cases) {
  try {
    const output = join(workspace, proof.name);
    mkdirSync(output, { recursive: true });
    const result = compileMojo({ target: { id: "mojo", options: {
      packageName: "native_async_proof", outputType: "lib",
    } }, files: { "index.ts": proof.source } });
    assert.deepEqual(result.diagnostics, []);
    for (const artifact of artifactTexts(result)) {
      const destination = resolve(output, artifact.path);
      const path = relative(output, destination);
      assert.ok(!path.startsWith("..") && !isAbsolute(path));
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, artifact.text);
    }
    writeFileSync(join(output, "runner.mojo"), proof.runner);
    generated++;
    for (const optimization of [0, 1, 2, 3]) {
      try {
        const binary = join(output, `proof-O${optimization}`);
        guarded(mojo, ["build", "-O", String(optimization), "-j", "1", "-I", join(output, "src"), "-I", join(runtime, "mojo"),
          join(output, "runner.mojo"), "-o", binary]);
        guarded(binary, []);
        executed++;
        process.stdout.write(`PASS native async ${proof.name} O${optimization}\n`);
      } catch (error) {
        failures.push(`${proof.name} O${optimization}: ${error.stack ?? error}`);
      }
    }
  } catch (error) {
    failures.push(`${proof.name}: ${error.stack ?? error}`);
  }
}
process.stdout.write(`Native async: ${generated}/${cases.length} generated; ${executed}/${cases.length * 4} required O0–O3 executions passed; output: ${workspace}\n`);
if (failures.length !== 0) throw new Error(failures.join("\n\n"));

function guarded(command, arguments_) {
  const result = spawnSync("systemd-run", ["--user", "--quiet", "--wait", "--pipe", "--collect",
    `--setenv=PATH=${process.env.PATH}`,
    `--setenv=MODULAR_HOME=${process.env.MODULAR_HOME ?? join(runtime, ".pixi/envs/default/share/max")}`,
    "--setenv=MODULAR_CRASH_REPORTING_ENABLED=0",
    "-p", "MemoryMax=3G", "-p", "MemorySwapMax=0", "-p", "TasksMax=96",
    "-p", "LimitCORE=0", "-p", "RuntimeMaxSec=120", command, ...arguments_],
  { cwd: root, stdio: "inherit", timeout: 150_000, killSignal: "SIGKILL" });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, `${command} failed: ${result.signal ?? result.status}`);
}
