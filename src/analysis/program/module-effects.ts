import type { Node } from "@tsonic/tsts";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type {
  MojoAnalyzedFunction,
  MojoAnalyzedModule,
} from "./model.js";

export interface MojoAnalyzedModuleRegionFacts {
  readonly dependencies: ReadonlySet<Node>;
  readonly directRaises: boolean;
}

export function finalizeMojoModuleEffects(
  analyzedModules: readonly MojoAnalyzedModule[],
  modules: MojoSourceModuleCatalog,
  moduleRegionFacts: WeakMap<MojoAnalyzedModule, MojoAnalyzedModuleRegionFacts>,
  finalizedByDeclaration: WeakMap<Node, MojoAnalyzedFunction>,
): readonly MojoAnalyzedModule[] {
  const analyzedBySourceFile = new WeakMap(
    analyzedModules.map((module) => [module.sourceFile, module] as const),
  );
  const raises = new Map(analyzedModules.map((module) => {
    const facts = moduleRegionFacts.get(module);
    const callableRaises = [...(facts?.dependencies ?? [])].some((dependency) =>
      finalizedByDeclaration.get(dependency)?.raises === true);
    return [module, facts?.directRaises === true || callableRaises] as const;
  }));
  const runtimeInitialization = new Map(
    analyzedModules.map((module) => [module, module.runtimeInitializationRequired] as const),
  );
  const asynchronous = new Map(
    analyzedModules.map((module) => [module, module.asynchronous] as const),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const module of analyzedModules) {
      const definition = modules.forSourceFile(module.sourceFile);
      const dependencies = definition?.dependencies ?? [];
      if (raises.get(module) !== true && dependencies.some((dependency) => {
        const target = analyzedBySourceFile.get(dependency.target.sourceFile);
        return target !== undefined && raises.get(target) === true;
      })) {
        raises.set(module, true);
        changed = true;
      }
      if (runtimeInitialization.get(module) !== true && dependencies.some((dependency) => {
        const target = analyzedBySourceFile.get(dependency.target.sourceFile);
        return target !== undefined && runtimeInitialization.get(target) === true;
      })) {
        runtimeInitialization.set(module, true);
        changed = true;
      }
      if (asynchronous.get(module) !== true && dependencies.some((dependency) => {
        const target = analyzedBySourceFile.get(dependency.target.sourceFile);
        return target !== undefined && asynchronous.get(target) === true;
      })) {
        asynchronous.set(module, true);
        changed = true;
      }
    }
  }
  return Object.freeze(analyzedModules.map((module) => Object.freeze({
    ...module,
    asynchronous: asynchronous.get(module) === true,
    raises: raises.get(module) === true,
    runtimeInitializationRequired: runtimeInitialization.get(module) === true,
  })));
}
