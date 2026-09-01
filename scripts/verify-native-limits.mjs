import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const runtimeRoot = resolve(repositoryRoot, "../mojo-runtime");
const pixi = process.env.TSONIC_MOJO_PIXI ?? join(homedir(), ".pixi", "bin", "pixi");
const fixtures = [
  ["class-inheritance.mojo", /unexpected|expected|inherit|parent/iu],
  ["dynamic-trait-value.mojo", /trait|type|parameter/iu],
  ["generator.mojo", /yield|unexpected|expected/iu],
  ["async-iteration.mojo", /async for|unexpected|expected/iu],
  ["async-context-manager.mojo", /async with|unexpected|expected/iu],
];

if (!existsSync(pixi)) throw new Error(`Pinned Mojo pixi executable is absent at '${pixi}'.`);
if (!existsSync(join(runtimeRoot, "pixi.toml"))) {
  throw new Error(`Pinned Mojo environment is absent at '${runtimeRoot}'.`);
}

const outputRoot = join(repositoryRoot, ".temp", "native-limit-artifacts");
mkdirSync(outputRoot, { recursive: true });
for (const [file, expected] of fixtures) {
    const source = join(repositoryRoot, "test", "fixtures", "native-limits", file);
    const output = join(outputRoot, `${basename(file, ".mojo")}.mojopkg`);
    const result = spawnSync(pixi, ["run", "mojo", "build", source, "-o", output], {
      cwd: runtimeRoot,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, MODULAR_MAX_MEMORY_GB: "4" },
    });
    if (result.error !== undefined) throw result.error;
    if (result.status === 0) {
      throw new Error(`Pinned Mojo unexpectedly accepted native-limit probe '${file}'.`);
    }
    const diagnostics = `${result.stdout}\n${result.stderr}`;
    if (!expected.test(diagnostics)) {
      throw new Error(`Native-limit probe '${file}' failed without its expected diagnostic:\n${diagnostics}`);
    }
    process.stdout.write(`proved ${file}\n`);
}
