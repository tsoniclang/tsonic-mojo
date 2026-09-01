import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
} from "./model.js";

type MojoStateDeclaration = MojoAnalyzedClass | MojoAnalyzedInterface;

export function closeMojoProjectStateStorage(
  classes: readonly MojoAnalyzedClass[],
  interfaces: readonly MojoAnalyzedInterface[],
): {
  readonly classes: readonly MojoAnalyzedClass[];
  readonly interfaces: readonly MojoAnalyzedInterface[];
} {
  const declarations = [...classes, ...interfaces];
  const declarationIds = new Set(declarations.flatMap((declaration) =>
    declaration.targetType.kind === "target-named" ? [declaration.targetType.id] : []));
  const edges = new Map<string, Set<string>>();
  for (const declaration of declarations) {
    if (declaration.targetType.kind !== "target-named") continue;
    const dependencies = new Set<string>();
    for (const type of stateFieldTypes(declaration)) {
      collectProjectTypeDependencies(type, declarationIds, dependencies, new Set());
    }
    edges.set(declaration.targetType.id, dependencies);
  }
  const erased = cyclicTypeIds(edges);
  return Object.freeze({
    classes: Object.freeze(classes.map((class_) => Object.freeze({
      ...class_,
      stateStorage: class_.targetType.kind === "target-named" && erased.has(class_.targetType.id)
        ? "erased" as const
        : "direct" as const,
    }))),
    interfaces: Object.freeze(interfaces.map((interface_) => Object.freeze({
      ...interface_,
      stateStorage: interface_.targetType.kind === "target-named" && erased.has(interface_.targetType.id)
        ? "erased" as const
        : "direct" as const,
    }))),
  });
}

function stateFieldTypes(declaration: MojoStateDeclaration): readonly MojoTargetTypeRef[] {
  return declaration.kind === "class"
    ? declaration.fields.map((field) => field.type)
    : [
        ...declaration.fields.map((field) => field.type),
        ...declaration.indexSignatures.flatMap((signature) => [signature.keyType, signature.valueType]),
      ];
}

function collectProjectTypeDependencies(
  type: MojoTargetTypeRef,
  projectTypeIds: ReadonlySet<string>,
  dependencies: Set<string>,
  visited: Set<MojoTargetTypeRef>,
): void {
  if (visited.has(type)) return;
  visited.add(type);
  switch (type.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "dynamic":
    case "bigint":
    case "symbol":
    case "type-parameter":
    case "compiler-expression":
      return;
    case "target-named":
      if (projectTypeIds.has(type.id)) dependencies.add(type.id);
      for (const argument of type.genericArguments ?? []) {
        if (argument.kind === "type") {
          collectProjectTypeDependencies(argument.type, projectTypeIds, dependencies, visited);
        }
      }
      return;
    case "list":
    case "fixed-array":
      collectProjectTypeDependencies(type.element, projectTypeIds, dependencies, visited);
      return;
    case "dictionary":
      collectProjectTypeDependencies(type.key, projectTypeIds, dependencies, visited);
      collectProjectTypeDependencies(type.value, projectTypeIds, dependencies, visited);
      return;
    case "future":
      collectProjectTypeDependencies(type.output, projectTypeIds, dependencies, visited);
      return;
    case "optional":
    case "reference":
      collectProjectTypeDependencies(type.value, projectTypeIds, dependencies, visited);
      return;
    case "union":
      for (const member of type.members) {
        collectProjectTypeDependencies(member, projectTypeIds, dependencies, visited);
      }
      return;
    case "tuple":
      for (const element of type.elements) {
        collectProjectTypeDependencies(element, projectTypeIds, dependencies, visited);
      }
      return;
    case "associated":
      collectProjectTypeDependencies(type.owner, projectTypeIds, dependencies, visited);
      for (const argument of type.genericArguments) {
        if (argument.kind === "type") {
          collectProjectTypeDependencies(argument.type, projectTypeIds, dependencies, visited);
        }
      }
      return;
    case "callable":
      for (const parameter of type.parameters) {
        collectProjectTypeDependencies(parameter.type, projectTypeIds, dependencies, visited);
      }
      collectProjectTypeDependencies(type.result, projectTypeIds, dependencies, visited);
      if (type.errorType !== undefined) {
        collectProjectTypeDependencies(type.errorType, projectTypeIds, dependencies, visited);
      }
      return;
    case "function":
      for (const parameter of type.genericParameters) {
        for (const constraint of parameter.constraints) {
          collectProjectTypeDependencies(constraint, projectTypeIds, dependencies, visited);
        }
        if (parameter.defaultArgument?.kind === "type") {
          collectProjectTypeDependencies(
            parameter.defaultArgument.type,
            projectTypeIds,
            dependencies,
            visited,
          );
        }
      }
      for (const parameter of type.parameters) {
        collectProjectTypeDependencies(parameter.type, projectTypeIds, dependencies, visited);
      }
      collectProjectTypeDependencies(type.result, projectTypeIds, dependencies, visited);
      if (type.errorType !== undefined) {
        collectProjectTypeDependencies(type.errorType, projectTypeIds, dependencies, visited);
      }
  }
}

function cyclicTypeIds(edges: ReadonlyMap<string, ReadonlySet<string>>): ReadonlySet<string> {
  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const cyclic = new Set<string>();

  const visit = (id: string): void => {
    const index = nextIndex++;
    indexes.set(id, index);
    lowLinks.set(id, index);
    stack.push(id);
    active.add(id);
    for (const dependency of [...(edges.get(id) ?? [])].sort((left, right) =>
      left.localeCompare(right, "en"))) {
      if (!edges.has(dependency)) continue;
      if (!indexes.has(dependency)) {
        visit(dependency);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(dependency)!));
      } else if (active.has(dependency)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indexes.get(dependency)!));
      }
    }
    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      active.delete(member);
      component.push(member);
      if (member === id) break;
    }
    if (component.length > 1 || (edges.get(id)?.has(id) ?? false)) {
      for (const member of component) cyclic.add(member);
    }
  };

  for (const id of [...edges.keys()].sort((left, right) => left.localeCompare(right, "en"))) {
    if (!indexes.has(id)) visit(id);
  }
  return cyclic;
}
