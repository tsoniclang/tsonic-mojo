import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type {
  MojoProjectHeritageEdge,
  MojoProjectTypeCatalog,
  MojoProjectTypeDefinition,
  MojoProjectTypeIssue,
  MojoProjectTypeRelationships,
  MojoProjectTypeRelationship,
} from "../../target-model/types/project.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import {
  substituteMojoTargetGenericArguments,
  substituteMojoTargetType,
} from "../../target-model/types/substitution.js";
import type {
  MojoTargetTypeSubstitutions,
} from "../../target-model/types/substitution.js";

const maximumMemberImplementations = 1_048_576;

export function createMojoProjectTypeRelationships(input: {
  readonly source: TargetSourceProgram;
  readonly projectTypes: MojoProjectTypeCatalog;
  resolveSelectedType(
    selectedType: import("@tsonic/tsts").Type,
    authoredTypeNode: Node | undefined,
    evidence: Node,
  ): MojoTargetTypeRef | undefined;
}): MojoProjectTypeRelationships {
  const { source, projectTypes } = input;
  const issues: MojoProjectTypeIssue[] = [];
  const heritageByDeclaration = new WeakMap<Node, readonly MojoProjectHeritageEdge[]>();

  for (const definition of projectTypes.definitions) {
    const selected = source.navigation.declaredHeritage(definition.declaration);
    if (selected.kind === "unresolved") {
      issues.push(Object.freeze({
        node: selected.heritage,
        code: "MOJO_PROJECT_HERITAGE_SOURCE_UNRESOLVED",
        message: selected.reason,
      }));
      heritageByDeclaration.set(definition.declaration, Object.freeze([]));
      continue;
    }
    const edges: MojoProjectHeritageEdge[] = [];
    for (const edge of selected.edges) {
      const target = projectTypes.definitionForDeclaration(edge.target.declaration);
      if (target === undefined) {
        issues.push(Object.freeze({
          node: edge.heritage,
          code: "MOJO_PROJECT_HERITAGE_TARGET_UNSUPPORTED",
          message: `Project ${definition.kind} '${definition.sourceName}' has heritage outside the project type model.`,
        }));
        continue;
      }
      const kindIssue = heritageKindIssue(definition, edge.kind, target);
      if (kindIssue !== undefined) {
        issues.push(Object.freeze({
          node: edge.heritage,
          code: "MOJO_PROJECT_HERITAGE_KIND_UNSUPPORTED",
          message: kindIssue,
        }));
        continue;
      }
      const targetType = input.resolveSelectedType(edge.selectedType, edge.heritage, edge.heritage);
      if (targetType?.kind !== "target-named" || targetType.id !== target.id ||
        !genericArgumentsMatch(target, targetType.genericArguments ?? [])) {
        issues.push(Object.freeze({
          node: edge.heritage,
          code: "MOJO_PROJECT_HERITAGE_CARRIER_UNRESOLVED",
          message: `Project heritage '${definition.sourceName}' -> '${target.sourceName}' has no exact Mojo target type.`,
        }));
        continue;
      }
      edges.push(Object.freeze({
        kind: edge.kind,
        source: definition,
        target,
        heritage: edge.heritage,
        targetType,
      }));
    }
    heritageByDeclaration.set(definition.declaration, Object.freeze(edges));
  }

  const definitionForType = (
    type: MojoTargetTypeRef | undefined,
  ): MojoProjectTypeDefinition | undefined => type?.kind === "target-named"
    ? projectTypes.definitionForId(type.id)
    : undefined;

  const definitionContainingDeclaration = (
    declaration: Node | undefined,
  ): MojoProjectTypeDefinition | undefined => {
    let current = declaration;
    while (current !== undefined) {
      const definition = projectTypes.definitionForDeclaration(current);
      if (definition !== undefined) return definition;
      current = source.ast.parent(current);
    }
    return undefined;
  };

  const openType = (definition: MojoProjectTypeDefinition): MojoTargetTypeRef => {
    const type = projectTypes.targetTypeForDefinition(
      definition,
      definition.typeParameters.map(genericParameterArgument),
    );
    if (type === undefined) {
      throw new Error(`Project type '${definition.sourceName}' has no exact open Mojo carrier.`);
    }
    return type;
  };

  const directSupertypes = (
    type: MojoTargetTypeRef,
  ): readonly MojoTargetTypeRef[] | undefined => {
    const definition = definitionForType(type);
    const substitutions = definition === undefined
      ? undefined
      : genericSubstitutions(definition, type);
    if (definition === undefined || substitutions === undefined) return undefined;
    return Object.freeze((heritageByDeclaration.get(definition.declaration) ?? []).map((edge) =>
      substituteMojoTargetType(edge.targetType, substitutions)));
  };

  const relationship = (
    sourceType: MojoTargetTypeRef,
    target: MojoProjectTypeDefinition,
  ): MojoProjectTypeRelationship => {
    const pending: MojoTargetTypeRef[] = [sourceType];
    const visited: MojoTargetTypeRef[] = [];
    const matches: MojoTargetTypeRef[] = [];
    while (pending.length !== 0) {
      const candidate = pending.shift()!;
      if (visited.some((entry) => mojoTargetTypeEquals(entry, candidate))) continue;
      visited.push(candidate);
      if (definitionForType(candidate) === target) {
        if (!matches.some((entry) => mojoTargetTypeEquals(entry, candidate))) matches.push(candidate);
        continue;
      }
      pending.push(...(directSupertypes(candidate) ?? []));
    }
    return matches.length === 0
      ? Object.freeze({ kind: "unrelated" })
      : matches.length === 1
        ? Object.freeze({ kind: "related", targetType: matches[0]! })
        : Object.freeze({ kind: "ambiguous", targetTypes: Object.freeze(matches) });
  };

  const classLineage = (
    definition: MojoProjectTypeDefinition,
  ): readonly MojoProjectTypeDefinition[] | undefined => {
    if (definition.kind !== "class") return undefined;
    const lineage: MojoProjectTypeDefinition[] = [];
    const seen = new Set<MojoProjectTypeDefinition>();
    let current: MojoProjectTypeDefinition | undefined = definition;
    while (current !== undefined) {
      if (seen.has(current)) return undefined;
      seen.add(current);
      lineage.unshift(current);
      const bases: readonly MojoProjectHeritageEdge[] = (
        heritageByDeclaration.get(current.declaration) ?? []
      ).filter((edge) =>
        edge.kind === "extends" && edge.target.kind === "class");
      if (bases.length > 1) return undefined;
      current = bases[0]?.target;
    }
    return Object.freeze(lineage);
  };

  const interfacesForClass = (
    definition: MojoProjectTypeDefinition,
  ): readonly MojoProjectTypeDefinition[] | undefined => {
    const lineage = classLineage(definition);
    if (lineage === undefined) return undefined;
    const result: MojoProjectTypeDefinition[] = [];
    const active = new Set<MojoProjectTypeDefinition>();
    const visit = (candidate: MojoProjectTypeDefinition): boolean => {
      if (result.includes(candidate)) return true;
      if (active.has(candidate) || candidate.kind !== "interface") return false;
      active.add(candidate);
      for (const edge of heritageByDeclaration.get(candidate.declaration) ?? []) {
        if (edge.kind !== "extends" || !visit(edge.target)) return false;
      }
      active.delete(candidate);
      result.push(candidate);
      return true;
    };
    for (const classDefinition of lineage) {
      for (const edge of heritageByDeclaration.get(classDefinition.declaration) ?? []) {
        if (edge.kind === "implements" && !visit(edge.target)) return undefined;
      }
    }
    return Object.freeze(result);
  };

  const polymorphic = new Set<MojoProjectTypeDefinition>();
  for (const definition of projectTypes.definitions) {
    for (const edge of heritageByDeclaration.get(definition.declaration) ?? []) {
      polymorphic.add(definition);
      polymorphic.add(edge.target);
    }
  }

  const implementationByClass = new WeakMap<
    MojoProjectTypeDefinition,
    WeakMap<Node, import("@tsonic/target-api/source").SourceProjectMemberImplementationResult>
  >();
  let implementationCount = 0;
  let budgetExceeded = false;
  for (const concreteClass of projectTypes.definitions) {
    if (concreteClass.kind !== "class") continue;
    const contracts = new Set<Node>();
    for (const candidate of projectTypes.definitions) {
      if (relationship(openType(concreteClass), candidate).kind !== "related") continue;
      for (const member of source.ast.members(candidate.declaration)) {
        if (member !== undefined) contracts.add(member);
      }
    }
    const implementations = new WeakMap<
      Node,
      import("@tsonic/target-api/source").SourceProjectMemberImplementationResult
    >();
    for (const contract of contracts) {
      implementationCount += 1;
      if (!Number.isSafeInteger(implementationCount) ||
        implementationCount > maximumMemberImplementations) {
        budgetExceeded = true;
        break;
      }
      implementations.set(
        contract,
        source.navigation.memberImplementation(concreteClass.declaration, contract),
      );
    }
    implementationByClass.set(concreteClass, implementations);
    if (budgetExceeded) break;
  }
  if (budgetExceeded) {
    const evidence = projectTypes.definitions[0]?.declaration ?? source.sourceFiles[0];
    if (evidence !== undefined) {
      issues.push(Object.freeze({
        node: evidence,
        code: "MOJO_PROJECT_MEMBER_IMPLEMENTATION_BUDGET_EXCEEDED",
        message: `Project member implementation analysis exceeds its finite ${maximumMemberImplementations}-classification budget.`,
      }));
    }
  }
  const unclassifiedImplementation = Object.freeze({
    kind: "unresolved" as const,
    reason: "The project member implementation was not classified before target-program sealing.",
  });

  const relationships: MojoProjectTypeRelationships = {
    definitions: projectTypes.definitions,
    issues: Object.freeze(issues),
    definitionContainingDeclaration,
    definitionForType,
    openType,
    heritageForDefinition(definition) {
      return heritageByDeclaration.get(definition.declaration) ?? Object.freeze([]);
    },
    directSupertypes,
    relationship,
    instantiateType(definition, instance, type) {
      const substitutions = genericSubstitutions(definition, instance);
      return substitutions === undefined
        ? undefined
        : substituteMojoTargetType(type, substitutions);
    },
    instantiateGenericArguments(definition, instance, arguments_) {
      const substitutions = genericSubstitutions(definition, instance);
      return substitutions === undefined
        ? undefined
        : substituteMojoTargetGenericArguments(arguments_, substitutions);
    },
    instantiateMemberType(member, receiver, declaredType) {
      const owner = definitionContainingDeclaration(member);
      if (owner === undefined) return undefined;
      const selected = relationship(receiver, owner);
      if (selected.kind !== "related") return undefined;
      const substitutions = genericSubstitutions(owner, selected.targetType);
      return substitutions === undefined
        ? undefined
        : substituteMojoTargetType(declaredType, substitutions);
    },
    isPolymorphic(definition) {
      return polymorphic.has(definition);
    },
    classLineage,
    interfacesForClass,
    concreteClassesFor(definition) {
      return Object.freeze(projectTypes.definitions.filter((candidate) =>
        candidate.kind === "class" && relationship(openType(candidate), definition).kind === "related"));
    },
    memberImplementation(concreteClass, contractMember) {
      return implementationByClass.get(concreteClass)?.get(contractMember) ??
        unclassifiedImplementation;
    },
  };
  return Object.freeze(relationships);
}

function heritageKindIssue(
  source: MojoProjectTypeDefinition,
  relation: "extends" | "implements",
  target: MojoProjectTypeDefinition,
): string | undefined {
  if (source.kind === "interface") {
    return relation === "extends" && target.kind === "interface"
      ? undefined
      : `Project interface '${source.sourceName}' can extend only another project interface.`;
  }
  if (source.kind !== "class") {
    return `Project ${source.kind} '${source.sourceName}' cannot declare class/interface heritage.`;
  }
  return relation === "extends"
    ? target.kind === "class"
      ? undefined
      : `Project class '${source.sourceName}' can extend only another project class.`
    : target.kind === "interface"
      ? undefined
      : `Project class '${source.sourceName}' can implement only a project interface.`;
}

function genericParameterArgument(
  parameter: MojoProjectTypeDefinition["typeParameters"][number],
): MojoTargetGenericArgument {
  switch (parameter.kind) {
    case "type": return Object.freeze({
      kind: "type",
      type: Object.freeze({
        kind: "type-parameter",
        name: parameter.name,
        identity: parameter.identity,
      }),
    });
    case "origin": return Object.freeze({
      kind: "origin",
      origin: Object.freeze({ kind: "parameter", name: parameter.name }),
    });
    case "value": return Object.freeze({ kind: "value-reference", path: Object.freeze([parameter.name]) });
  }
}

function genericArgumentsMatch(
  definition: MojoProjectTypeDefinition,
  arguments_: readonly MojoTargetGenericArgument[],
): boolean {
  return arguments_.length === definition.typeParameters.length &&
    arguments_.every((argument, index) => {
      const kind = definition.typeParameters[index]!.kind;
      return kind === "type"
        ? argument.kind === "type" || argument.kind === "type-expression"
        : kind === "origin"
          ? argument.kind === "origin"
          : argument.kind !== "type" && argument.kind !== "type-expression" && argument.kind !== "origin";
    });
}

function genericSubstitutions(
  definition: MojoProjectTypeDefinition,
  type: MojoTargetTypeRef,
): MojoTargetTypeSubstitutions | undefined {
  if (type.kind !== "target-named" || type.id !== definition.id) return undefined;
  const arguments_ = type.genericArguments ?? [];
  if (!genericArgumentsMatch(definition, arguments_)) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  for (const [index, parameter] of definition.typeParameters.entries()) {
    const argument = arguments_[index]!;
    if (parameter.kind === "type") {
      if (argument.kind !== "type") return undefined;
      types.set(parameter.name, argument.type);
    } else if (parameter.kind === "origin") {
      if (argument.kind !== "origin") return undefined;
      origins.set(parameter.name, argument.origin);
    } else {
      values.set(parameter.name, argument);
    }
  }
  return Object.freeze({ types, values, origins, packs: new Map() });
}
