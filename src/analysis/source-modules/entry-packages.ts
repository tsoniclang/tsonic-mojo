import type { MojoSourceModuleConstruction } from "./construction.js";
import type { MojoSourceModuleCatalog, MojoSourceModuleIssue } from "./model.js";

export function closeMojoSourceModuleEntryPackages(
  modules: MojoSourceModuleCatalog,
  entries: readonly MojoSourceModuleConstruction[],
): { readonly modules: MojoSourceModuleCatalog; readonly issues: readonly MojoSourceModuleIssue[] } {
  if (entries.length === 0) return Object.freeze({ modules, issues: Object.freeze([]) });
  const issues: MojoSourceModuleIssue[] = [];
  const roots = modules.packages.filter((entry) => entry.root);
  if (roots.length !== 1) {
    return Object.freeze({ modules, issues: Object.freeze([Object.freeze({
      code: "MOJO_SOURCE_MODULE_ENTRY_ROOT_MISSING",
      message: "Compiled source-module entries require one exact root package component.",
    })]) });
  }
  const root = roots[0]!;
  const packages = new Map(modules.packages.map((entry) => [entry.componentId, entry]));
  const reachable = new Set<string>();
  const pending = [root.componentId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const component = packages.get(id);
    if (component === undefined) {
      issues.push(Object.freeze({
        code: "MOJO_SOURCE_MODULE_ENTRY_COMPONENT_MISSING",
        message: `Compiled source-module entry closure depends on unknown package component '${id}'.`,
      }));
      continue;
    }
    pending.push(...component.dependencies);
  }
  const dependencies = new Set(root.dependencies);
  for (const entry of entries) {
    const module = modules.forSourceFile(entry.sourceFile);
    if (module === undefined || !packages.has(module.componentId) || !reachable.has(module.componentId)) {
      issues.push(Object.freeze({
        code: "MOJO_SOURCE_MODULE_ENTRY_COMPONENT_MISSING",
        message: "A compiled source-module entry is not in the exact root package dependency closure.",
        node: entry.argument,
      }));
      continue;
    }
    if (module.componentId !== root.componentId) dependencies.add(module.componentId);
  }
  if (issues.length > 0) return Object.freeze({ modules, issues: Object.freeze(issues) });
  return Object.freeze({
    modules: Object.freeze({
      ...modules,
      packages: Object.freeze(modules.packages.map((entry) => entry !== root ? entry : Object.freeze({
        ...entry,
        dependencies: Object.freeze([...dependencies].sort((left, right) => left.localeCompare(right, "en"))),
      }))),
    }),
    issues: Object.freeze([]),
  });
}
