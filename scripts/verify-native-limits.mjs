import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = resolve(repositoryRoot, "../mojo-runtime");
const pixi = process.env.TSONIC_MOJO_PIXI ?? join(homedir(), ".pixi", "bin", "pixi");
const fixtures = [
  ["class-inheritance.mojo", 5, /structs only conform to traits/iu],
  ["dynamic-trait-value.mojo", 7, /invalid call.*AnyTrait\[Counter\]/iu],
  ["generator.mojo", 2, /unexpected token in expression/iu],
  ["async-iteration.mojo", 2, /expected '\(' for argument list/iu],
  ["async-context-manager.mojo", 2, /expected '\(' for argument list/iu],
];

if (!existsSync(pixi)) throw new Error(`Pinned Mojo pixi executable is absent at '${pixi}'.`);
if (!existsSync(join(runtimeRoot, "pixi.toml"))) {
  throw new Error(`Pinned Mojo environment is absent at '${runtimeRoot}'.`);
}

const outputRoot = join(repositoryRoot, ".temp", "native-limit-artifacts");
mkdirSync(outputRoot, { recursive: true });
const failures = [];
for (const [file, line, expected] of fixtures) {
    const source = join(repositoryRoot, "test", "fixtures", "native-limits", file);
    const output = join(outputRoot, `${basename(file, ".mojo")}.mojopkg`);
    const result = spawnSync(pixi, ["run", "mojo", "build", source, "-o", output], {
      cwd: runtimeRoot,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, MODULAR_MAX_MEMORY_GB: "4" },
    });
    if (result.error !== undefined) {
      failures.push(`${file}: ${result.error.message}`);
      continue;
    }
    if (result.status === 0) {
      failures.push(`Pinned Mojo unexpectedly accepted native-limit probe '${file}'.`);
      continue;
    }
    const diagnostics = `${result.stdout}\n${result.stderr}`;
    const selectedErrors = diagnostics.split("\n").filter((message) =>
      message.startsWith(`${source}:${line}:`) && message.includes(": error: ")
    ).map((message) => message.slice(message.indexOf(": error: ") + 9));
    if (!selectedErrors.some((message) => expected.test(message))) {
      failures.push(`Native-limit probe '${file}' failed without its expected diagnostic:\n${diagnostics}`);
      continue;
    }
    process.stdout.write(`proved ${file}\n`);
}
if (failures.length !== 0) throw new Error(failures.join("\n\n"));
