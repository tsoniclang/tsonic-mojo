import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoSourceModuleCatalog, MojoSourceModuleDefinition } from "../source-modules/model.js";
import type { MojoAnalyzedModule } from "./model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";

export function diagnoseMojoRuntimeModuleCycles(
  analyzedModules: readonly MojoAnalyzedModule[],
  sourceModules: MojoSourceModuleCatalog,
): readonly TargetDiagnostic[] {
  const analyzedById = new Map(analyzedModules.map((module) => [module.id, module] as const));
  const definitionById = new Map(sourceModules.definitions.map((module) => [module.id, module] as const));
  const indexes = new Map<MojoSourceModuleDefinition, number>();
  const lowLinks = new Map<MojoSourceModuleDefinition, number>();
  const active = new Set<MojoSourceModuleDefinition>();
  const stack: MojoSourceModuleDefinition[] = [];
  const diagnostics: TargetDiagnostic[] = [];
  let nextIndex = 0;

  const visit = (module: MojoSourceModuleDefinition): void => {
    const index = nextIndex++;
    indexes.set(module, index);
    lowLinks.set(module, index);
    active.add(module);
    stack.push(module);
    for (const dependency of module.dependencies) {
      const target = definitionById.get(dependency.target.id);
      if (target === undefined) continue;
      if (!indexes.has(target)) {
        visit(target);
        lowLinks.set(module, Math.min(lowLinks.get(module)!, lowLinks.get(target)!));
      } else if (active.has(target)) {
        lowLinks.set(module, Math.min(lowLinks.get(module)!, indexes.get(target)!));
      }
    }
    if (lowLinks.get(module) !== index) return;
    const component: MojoSourceModuleDefinition[] = [];
    for (;;) {
      const member = stack.pop()!;
      active.delete(member);
      component.push(member);
      if (member === module) break;
    }
    const cyclic = component.length > 1 || component[0]!.dependencies.some((dependency) =>
      dependency.target.id === component[0]!.id);
    const runtime = component.some((member) =>
      analyzedById.get(member.id)?.runtimeInitializationRequired === true);
    if (!cyclic || !runtime) return;
    const ordered = [...component].sort((left, right) =>
      left.relativeSourcePath.localeCompare(right.relativeSourcePath, "en"));
    diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_RUNTIME_MODULE_CYCLE_UNSUPPORTED",
      `Runtime ES module cycle '${ordered.map(({ relativeSourcePath }) => relativeSourcePath).join(" -> ")}' requires live-binding and temporal-dead-zone semantics that are not represented by the pinned Mojo compiler.`,
      ordered[0]!.sourceFile,
    ));
  };

  for (const module of sourceModules.definitions) {
    if (!indexes.has(module)) visit(module);
  }
  return Object.freeze(diagnostics);
}
