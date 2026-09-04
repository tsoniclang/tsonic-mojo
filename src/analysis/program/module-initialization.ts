import type { MojoSourceModuleCatalog, MojoSourceModuleDefinition } from "../source-modules/model.js";
import type {
  MojoAnalyzedModule,
  MojoModuleInitializationCatalog,
  MojoModuleInitializationComponent,
} from "./model.js";
import { closeMojoErrorType, mergeMojoErrorTypes } from "./effects.js";

export interface MojoModuleInitializationIssue {
  readonly code: string;
  readonly message: string;
  readonly node: import("@tsonic/tsts").Node;
}

export interface MojoModuleInitializationAnalysis {
  readonly catalog: MojoModuleInitializationCatalog;
  readonly issues: readonly MojoModuleInitializationIssue[];
}

export function analyzeMojoModuleInitialization(
  analyzedModules: readonly MojoAnalyzedModule[],
  sourceModules: MojoSourceModuleCatalog,
): MojoModuleInitializationAnalysis {
  const analyzedById = new Map(analyzedModules.map((module) => [module.id, module] as const));
  const definitionById = new Map(
    sourceModules.definitions.map((definition) => [definition.id, definition] as const),
  );
  const evaluationOrder = moduleEvaluationOrder(sourceModules, definitionById);
  const evaluationIndex = new Map(evaluationOrder.map((definition, index) => [definition.id, index]));
  const sourceComponents = stronglyConnectedModules(sourceModules.definitions, definitionById);
  const componentIndexByModuleId = new Map<string, number>();
  sourceComponents.forEach((members, componentIndex) => {
    for (const member of members) componentIndexByModuleId.set(member.id, componentIndex);
  });
  const components: MojoModuleInitializationComponent[] = [];
  const issues: MojoModuleInitializationIssue[] = [];
  for (const [componentIndex, sourceMembers] of sourceComponents.entries()) {
    const orderedDefinitions = [...sourceMembers].sort((left, right) =>
      (evaluationIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (evaluationIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.relativeSourcePath.localeCompare(right.relativeSourcePath, "en"));
    const members = orderedDefinitions
      .map((definition) => analyzedById.get(definition.id))
      .filter((module): module is MojoAnalyzedModule => module !== undefined);
    if (members.length === 0) continue;
    const owner = members[members.length - 1]!;
    const cyclic = members.length > 1 || orderedDefinitions[0]!.dependencies.some((dependency) =>
      dependency.target.id === orderedDefinitions[0]!.id);
    const directAsynchronous = members.some((module) => module.directAsynchronous);
    if (cyclic && directAsynchronous) {
      issues.push(Object.freeze({
        code: "MOJO_ASYNC_RUNTIME_MODULE_CYCLE_NATIVE_LIMIT",
        message: `Asynchronous ES module cycle '${orderedDefinitions
          .map(({ relativeSourcePath }) => relativeSourcePath)
          .join(" -> ")}' cannot be represented without a native asynchronous module-cycle protocol.`,
        node: owner.sourceFile,
      }));
    }
    const dependencies = new Set<number>();
    for (const definition of orderedDefinitions) {
      for (const dependency of definition.dependencies) {
        const dependencyIndex = componentIndexByModuleId.get(dependency.target.id);
        if (dependencyIndex !== undefined && dependencyIndex !== componentIndex) {
          dependencies.add(dependencyIndex);
        }
      }
    }
    const dependencyComponentIndexes = [...dependencies].sort((left, right) =>
      firstEvaluationIndex(sourceComponents[left]!, evaluationIndex) -
        firstEvaluationIndex(sourceComponents[right]!, evaluationIndex));
    const errorType = closeMojoErrorType(mergeMojoErrorTypes(
      ...members.map((module) => module.errorType === undefined ? [] : [module.errorType]),
    ));
    components.push(Object.freeze({
      id: owner.id,
      ownerModuleId: owner.id,
      memberModuleIds: Object.freeze(members.map((module) => module.id)),
      dependencyComponentIds: Object.freeze(dependencyComponentIndexes.map((index) => {
        const definitions = sourceComponents[index]!;
        const ordered = [...definitions].sort((left, right) =>
          (evaluationIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
            (evaluationIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
          left.relativeSourcePath.localeCompare(right.relativeSourcePath, "en"));
        return ordered[ordered.length - 1]!.id;
      })),
      cyclic,
      asynchronous: members.some((module) => module.asynchronous),
      raises: errorType !== undefined,
      ...(errorType === undefined ? {} : { errorType }),
      directRuntimeInitializationRequired: members.some((module) =>
        module.directRuntimeInitializationRequired),
      runtimeInitializationRequired: members.some((module) =>
        module.runtimeInitializationRequired),
    }));
  }
  const componentById = new Map(components.map((component) => [component.id, component] as const));
  const componentByModuleId = new Map<string, MojoModuleInitializationComponent>();
  for (const component of components) {
    for (const moduleId of component.memberModuleIds) componentByModuleId.set(moduleId, component);
  }
  return Object.freeze({
    catalog: Object.freeze({
      components: Object.freeze(components.sort((left, right) => {
        const leftDefinition = definitionById.get(left.ownerModuleId)!;
        const rightDefinition = definitionById.get(right.ownerModuleId)!;
        return leftDefinition.artifactPath.localeCompare(rightDefinition.artifactPath, "en");
      })),
      componentForId(id: string) {
        return componentById.get(id);
      },
      componentForModuleId(moduleId: string) {
        return componentByModuleId.get(moduleId);
      },
    }),
    issues: Object.freeze(issues),
  });
}

function moduleEvaluationOrder(
  sourceModules: MojoSourceModuleCatalog,
  definitionById: ReadonlyMap<string, MojoSourceModuleDefinition>,
): readonly MojoSourceModuleDefinition[] {
  const visited = new Set<string>();
  const active = new Set<string>();
  const order: MojoSourceModuleDefinition[] = [];
  const visit = (definition: MojoSourceModuleDefinition): void => {
    if (visited.has(definition.id) || active.has(definition.id)) return;
    active.add(definition.id);
    for (const dependency of definition.dependencies) {
      const target = definitionById.get(dependency.target.id);
      if (target !== undefined) visit(target);
    }
    active.delete(definition.id);
    visited.add(definition.id);
    order.push(definition);
  };
  visit(sourceModules.entryPoint);
  for (const definition of sourceModules.definitions) visit(definition);
  return Object.freeze(order);
}

function stronglyConnectedModules(
  definitions: readonly MojoSourceModuleDefinition[],
  definitionById: ReadonlyMap<string, MojoSourceModuleDefinition>,
): readonly (readonly MojoSourceModuleDefinition[])[] {
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const active = new Set<string>();
  const stack: MojoSourceModuleDefinition[] = [];
  const components: MojoSourceModuleDefinition[][] = [];
  let nextIndex = 0;
  const visit = (definition: MojoSourceModuleDefinition): void => {
    const index = nextIndex++;
    indexes.set(definition.id, index);
    lowLinks.set(definition.id, index);
    active.add(definition.id);
    stack.push(definition);
    for (const dependency of definition.dependencies) {
      const target = definitionById.get(dependency.target.id);
      if (target === undefined) continue;
      if (!indexes.has(target.id)) {
        visit(target);
        lowLinks.set(definition.id, Math.min(lowLinks.get(definition.id)!, lowLinks.get(target.id)!));
      } else if (active.has(target.id)) {
        lowLinks.set(definition.id, Math.min(lowLinks.get(definition.id)!, indexes.get(target.id)!));
      }
    }
    if (lowLinks.get(definition.id) !== index) return;
    const component: MojoSourceModuleDefinition[] = [];
    for (;;) {
      const member = stack.pop()!;
      active.delete(member.id);
      component.push(member);
      if (member.id === definition.id) break;
    }
    components.push(component);
  };
  for (const definition of definitions) {
    if (!indexes.has(definition.id)) visit(definition);
  }
  return Object.freeze(components.map((component) => Object.freeze(component)));
}

function firstEvaluationIndex(
  definitions: readonly MojoSourceModuleDefinition[],
  evaluationIndex: ReadonlyMap<string, number>,
): number {
  return Math.min(...definitions.map((definition) =>
    evaluationIndex.get(definition.id) ?? Number.MAX_SAFE_INTEGER));
}
