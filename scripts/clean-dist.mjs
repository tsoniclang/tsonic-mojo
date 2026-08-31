import { readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
if (manifest.name !== "@tsonic/target-mojo") {
  throw new Error(`Refusing to clean dist for unexpected package '${String(manifest.name)}'.`);
}
rmSync(resolve(repositoryRoot, "dist"), { recursive: true, force: true });
