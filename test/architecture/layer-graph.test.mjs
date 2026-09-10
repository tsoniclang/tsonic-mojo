import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../src", import.meta.url));
const layers = [
  "analysis", "backend", "compilation", "descriptor", "options", "policy",
  "print", "providers", "public", "source", "target-model", "toolchain",
];

test("Mojo retains the twelve canonical C# and Rust target layers", () => {
  assert.deepEqual(readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(), layers);
});

test("resolved relative imports preserve classification and printing boundaries", () => {
  const violations = [];
  for (const file of files(root)) {
    const path = relative(root, file);
    const owner = path.split("/")[0];
    for (const match of readFileSync(file, "utf8").matchAll(
      /\b(?:from\s*|import\s*)["'](\.[^"']+)["']/gu,
    )) {
      const destination = relative(root, resolve(dirname(file), match[1]));
      const target = destination.split("/")[0];
      const forbidden = {
        "target-model": ["analysis", "backend", "compilation", "policy", "providers"],
        policy: ["analysis", "backend", "compilation"],
        analysis: ["backend"],
        print: ["analysis", "compilation", "policy", "providers", "source"],
      };
      if (forbidden[owner]?.includes(target) ||
          (owner === "print" && target === "backend" &&
            !destination.startsWith("backend/target-ast/") &&
            !destination.startsWith("backend/artifact-model/"))) {
        violations.push(`${path} -> ${destination}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("the planner has no executable static dependency on analysis", () => {
  const violations = [];
  for (const file of files(resolve(root, "backend/planner"))) {
    for (const specifier of staticRuntimeImports(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith(".")) continue;
      const destination = relative(root, resolve(dirname(file), specifier));
      if (destination.startsWith("analysis/")) {
        violations.push(`${relative(root, file)} -> ${destination}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("the static import boundary distinguishes type evidence from executable aliases", () => {
  assert.deepEqual(staticRuntimeImports(`
import type { Evidence } from "../analysis/types.js";
import { type Evidence } from "../analysis/types.js";
import { type Evidence, select as anotherName } from "../analysis/select.js";
import * as classifier from "../analysis/index.js";
import "../analysis/effects.js";
`), ["../analysis/select.js", "../analysis/index.js", "../analysis/effects.js"]);
});

function staticRuntimeImports(source) {
  const imports = [];
  for (const match of source.matchAll(/^import\s+(type\s+)?(\{[\s\S]*?\}|[^;\n]+?)\s+from\s*["']([^"']+)["'];/gmu)) {
    if (match[1] !== undefined) continue;
    const bindings = match[2].trim();
    if (bindings.startsWith("{") && bindings.slice(1, -1).split(",")
      .map((binding) => binding.trim()).filter(Boolean).every((binding) => binding.startsWith("type "))) continue;
    imports.push(match[3]);
  }
  for (const match of source.matchAll(/^import\s*["']([^"']+)["'];/gmu)) {
    imports.push(match[1]);
  }
  return imports;
}

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  }).sort();
}
