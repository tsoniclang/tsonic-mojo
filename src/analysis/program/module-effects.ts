import type { Node } from "@tsonic/tsts";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type { MojoAnalyzedModule } from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { closeMojoErrorType, mergeMojoErrorTypes } from "./effects.js";

export interface MojoAnalyzedModuleRegionFacts {
  readonly dependencies: ReadonlySet<Node>;
  readonly directErrorTypes: readonly MojoTargetTypeRef[];
}

export function finalizeMojoModuleEffects(
  analyzedModules: readonly MojoAnalyzedModule[],
  modules: MojoSourceModuleCatalog,
  moduleRegionFacts: WeakMap<MojoAnalyzedModule, MojoAnalyzedModuleRegionFacts>,
  errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>,
): readonly MojoAnalyzedModule[] {
  const analyzedById = new Map(
    analyzedModules.map((module) => [module.id, module] as const),
  );
  const errorTypes = new Map(analyzedModules.map((module) => {
    const facts = moduleRegionFacts.get(module);
    return [module, mergeMojoErrorTypes(
      facts?.directErrorTypes ?? [],
      ...[...(facts?.dependencies ?? [])].map((dependency) =>
        errorTypesByDeclaration.get(dependency) ?? []),
    )] as const;
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
      const currentErrors = errorTypes.get(module) ?? [];
      const nextErrors = mergeMojoErrorTypes(
        currentErrors,
        ...dependencies.map((dependency) => {
          const target = analyzedById.get(dependency.target.id);
          return target === undefined ? [] : errorTypes.get(target) ?? [];
        }),
      );
      if (nextErrors.length !== currentErrors.length) {
        errorTypes.set(module, nextErrors);
        changed = true;
      }
      if (runtimeInitialization.get(module) !== true && dependencies.some((dependency) => {
        const target = analyzedById.get(dependency.target.id);
        return target !== undefined && runtimeInitialization.get(target) === true;
      })) {
        runtimeInitialization.set(module, true);
        changed = true;
      }
      if (asynchronous.get(module) !== true && dependencies.some((dependency) => {
        const target = analyzedById.get(dependency.target.id);
        return target !== undefined && asynchronous.get(target) === true;
      })) {
        asynchronous.set(module, true);
        changed = true;
      }
    }
  }
  return Object.freeze(analyzedModules.map((module) => {
    const errorType = closeMojoErrorType(errorTypes.get(module) ?? []);
    return Object.freeze({
      ...module,
      asynchronous: asynchronous.get(module) === true,
      raises: errorType !== undefined,
      ...(errorType === undefined ? {} : { errorType }),
      initializationStateRequired: module.initializationStateRequired,
      runtimeInitializationRequired: runtimeInitialization.get(module) === true,
    });
  }));
}
