import type { MojoProviderSemantics, MojoProviderTypeRow } from "../../providers/packages/model.js";
import type {
  MojoLifecycleCapabilities,
  MojoNamedLifecycleContract,
  MojoLifecycleTraitRole,
  MojoRegisterPassingCapability,
} from "../../target-model/lifecycle/model.js";
import type {
  MojoTargetConformanceCondition,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { mojoTargetGenericArgumentsEqual } from "../../target-model/types/equality.js";
import { mojoTargetTypeKey } from "../../target-model/types/key.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoLifecycleAnalysis, MojoLifecycleCatalog } from "./model.js";

const implicitLifecycle = lifecycle("implicit", true, true, "trivial");
const implicitHeapLifecycle = lifecycle("implicit", true, true, "unavailable");
const explicitLifecycle = lifecycle("explicit", true, true, "unavailable");
const moveOnlyLifecycle = lifecycle("unavailable", true, true, "unavailable");
const unavailableLifecycle = lifecycle("unavailable", false, false, "unavailable");

export function createMojoLifecycleResolver(input: {
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly providerSemantics: MojoProviderSemantics;
}): MojoLifecycleAnalysis {
  const capabilitiesByKey = new Map<string, MojoLifecycleCapabilities>();
  const typeByKey = new Map<string, MojoTargetTypeRef>();
  const namedLifecycleById = new Map<string, MojoNamedLifecycleContract>();
  for (const row of input.providerSemantics.types) {
    if (row.targetType.kind === "target-named" && row.targetType.lifecycle !== undefined) {
      registerNamedLifecycle(namedLifecycleById, row.targetType.id, row.targetType.lifecycle);
    }
  }
  const resolutionInput = Object.freeze({ ...input, namedLifecycleById });
  let sealed = false;

  const compute = (
    type: MojoTargetTypeRef,
    resolving: Set<string>,
  ): MojoLifecycleCapabilities => {
    const key = mojoTargetTypeKey(type);
    if (type.kind === "target-named" && type.lifecycle !== undefined) {
      registerNamedLifecycle(namedLifecycleById, type.id, type.lifecycle);
    }
    const existing = capabilitiesByKey.get(key);
    if (existing !== undefined) return existing;
    if (sealed) throw new Error(`Mojo lifecycle capability was not sealed for '${key}'.`);
    typeByKey.set(key, type);
    if (resolving.has(key)) return unavailableLifecycle;
    resolving.add(key);
    const resolved = resolveCapabilities(type, resolutionInput, (nested) => {
      return compute(nested, resolving);
    });
    resolving.delete(key);
    capabilitiesByKey.set(key, resolved);
    return resolved;
  };

  const capabilities = (type: MojoTargetTypeRef): MojoLifecycleCapabilities =>
    compute(type, new Set<string>());

  return Object.freeze({
    capabilities,
    seal(types: readonly MojoTargetTypeRef[]): MojoLifecycleCatalog {
      for (const type of types) visitType(type, capabilities);
      const entries = Object.freeze([...capabilitiesByKey.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, value]) => Object.freeze({ type: typeByKey.get(key)!, capabilities: value })));
      sealed = true;
      return Object.freeze({ entries, capabilities });
    },
  });
}

function resolveCapabilities(
  type: MojoTargetTypeRef,
  input: {
    readonly projectTypes: MojoProjectTypeCatalog;
    readonly providerSemantics: MojoProviderSemantics;
    readonly namedLifecycleById: ReadonlyMap<string, MojoNamedLifecycleContract>;
  },
  resolve: (type: MojoTargetTypeRef) => MojoLifecycleCapabilities,
): MojoLifecycleCapabilities {
  switch (type.kind) {
    case "source-primitive":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "symbol":
    case "reference":
    case "function":
    case "callable":
      return implicitLifecycle;
    case "native-string":
      return lifecycle("implicit", true, true, "unavailable");
    case "bigint":
      return explicitLifecycle;
    case "dynamic":
      return type.domain === "js" ? implicitHeapLifecycle : explicitLifecycle;
    case "type-parameter": {
      const roles = new Set(type.lifecycleRequirements ?? []);
      return roles.size === 0 ? unavailableLifecycle : lifecycleForRoles(roles);
    }
    case "associated":
    case "compiler-expression":
      return unavailableLifecycle;
    case "future":
      return moveOnlyLifecycle;
    case "list":
      return aggregateLifecycle([resolve(type.element)], false);
    case "fixed-array":
      return aggregateLifecycle([resolve(type.element)], false);
    case "dictionary":
      return aggregateLifecycle([resolve(type.key), resolve(type.value)], false);
    case "optional":
      return aggregateLifecycle([resolve(type.value)], true);
    case "union":
      return aggregateLifecycle(type.members.map(resolve), true);
    case "tuple":
      return aggregateLifecycle(type.elements.map(resolve), true);
    case "target-named": {
      const project = input.projectTypes.definitionForId(type.id);
      if (project?.kind === "class" || project?.kind === "interface") {
        return lifecycle("implicit", true, true, "unavailable");
      }
      if (project?.kind === "enum") return implicitLifecycle;
      const lifecycleContract = type.lifecycle ?? input.namedLifecycleById.get(type.id);
      if (lifecycleContract?.kind === "fixed") return lifecycleContract.capabilities;
      if (lifecycleContract?.kind === "aggregate") {
        const members = lifecycleContract.genericArgumentIndexes.map((index) =>
          genericTypeArgument(type.genericArguments?.[index])).map((argument) =>
          argument === undefined ? undefined : resolve(argument));
        return members.some((member) => member === undefined)
          ? unavailableLifecycle
          : aggregateLifecycle(
              members as readonly MojoLifecycleCapabilities[],
              lifecycleContract.implicitCopyWhenPossible,
              lifecycleContract.explicitDestruction,
            );
      }
      return providerLifecycle(type, input.providerSemantics.types, resolve);
    }
  }
}

function registerNamedLifecycle(
  contracts: Map<string, MojoNamedLifecycleContract>,
  typeId: string,
  contract: MojoNamedLifecycleContract,
): void {
  const existing = contracts.get(typeId);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(contract)) {
    throw new Error(`Mojo target type '${typeId}' has conflicting exact lifecycle contracts.`);
  }
  contracts.set(typeId, contract);
}

function providerLifecycle(
  type: Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>,
  rows: readonly MojoProviderTypeRow[],
  resolve: (type: MojoTargetTypeRef) => MojoLifecycleCapabilities,
): MojoLifecycleCapabilities {
  const candidates = rows.flatMap((row) => {
    if (row.targetType.kind !== "target-named" || row.targetType.id !== type.id) return [];
    const substitutions = genericSubstitutions(row.targetType, type);
    return substitutions === undefined ? [] : [{ row, substitutions }];
  });
  if (candidates.length === 0) return unavailableLifecycle;
  const roles = new Set<MojoLifecycleTraitRole>();
  for (const { row, substitutions } of candidates) {
    for (const conformance of row.conformances ?? []) {
      if (conformance.lifecycleRole === undefined ||
        (conformance.condition !== undefined &&
          !evaluateCondition(conformance.condition, substitutions, resolve))) continue;
      roles.add(conformance.lifecycleRole);
    }
  }
  return lifecycleForRoles(roles);
}

function lifecycleForRoles(
  roles: ReadonlySet<MojoLifecycleTraitRole>,
): MojoLifecycleCapabilities {
  const trivialRegister = roles.has("trivial-register-passable");
  const register = trivialRegister || roles.has("register-passable");
  const implicitCopy = trivialRegister || roles.has("implicitly-copyable");
  const explicitCopy = implicitCopy || roles.has("copyable");
  const copy = implicitCopy
    ? "implicit" as const
    : explicitCopy ? "explicit" as const : "unavailable" as const;
  const registerPassing: MojoRegisterPassingCapability = trivialRegister
    ? "trivial"
    : register ? "register" : "unavailable";
  return lifecycle(
    copy,
    roles.has("movable") || copy !== "unavailable" || register,
    roles.has("deinitializable") || trivialRegister,
    registerPassing,
  );
}

function genericSubstitutions(
  template: Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>,
  actual: Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>,
): ReadonlyMap<string, MojoTargetGenericArgument> | undefined {
  const templateArguments = template.genericArguments ?? [];
  const actualArguments = actual.genericArguments ?? [];
  if (templateArguments.length !== actualArguments.length) return undefined;
  const substitutions = new Map<string, MojoTargetGenericArgument>();
  for (const [index, templateArgument] of templateArguments.entries()) {
    const actualArgument = actualArguments[index]!;
    const name = genericParameterName(templateArgument);
    if (name === undefined) {
      if (!mojoTargetGenericArgumentsEqual([templateArgument], [actualArgument])) return undefined;
      continue;
    }
    const existing = substitutions.get(name);
    if (existing !== undefined &&
      !mojoTargetGenericArgumentsEqual([existing], [actualArgument])) {
      return undefined;
    }
    substitutions.set(name, actualArgument);
  }
  return substitutions;
}

function genericParameterName(argument: MojoTargetGenericArgument): string | undefined {
  if (argument.kind === "type" && argument.type.kind === "type-parameter") {
    return argument.type.name;
  }
  if (argument.kind === "value-reference" && argument.path.length === 1) return argument.path[0];
  if (argument.kind === "origin" && argument.origin.kind === "parameter") return argument.origin.name;
  return undefined;
}

function evaluateCondition(
  condition: MojoTargetConformanceCondition,
  substitutions: ReadonlyMap<string, MojoTargetGenericArgument>,
  resolve: (type: MojoTargetTypeRef) => MojoLifecycleCapabilities,
): boolean {
  switch (condition.kind) {
    case "boolean": return condition.value;
    case "conforms-to": {
      if (condition.lifecycleRoles === undefined ||
        condition.lifecycleRoles.length !== condition.traitNames.length) return false;
      const argument = substitutions.get(condition.subject);
      const type = argument === undefined ? undefined : genericTypeArgument(argument);
      if (type === undefined) return false;
      const capabilities = resolve(type);
      return condition.lifecycleRoles.every((role) => hasLifecycleRole(capabilities, role));
    }
    case "not": return !evaluateCondition(condition.operand, substitutions, resolve);
    case "all": return condition.operands.every((operand) =>
      evaluateCondition(operand, substitutions, resolve));
    case "any": return condition.operands.some((operand) =>
      evaluateCondition(operand, substitutions, resolve));
    case "conditional": return evaluateCondition(condition.condition, substitutions, resolve)
      ? evaluateCondition(condition.whenTrue, substitutions, resolve)
      : evaluateCondition(condition.whenFalse, substitutions, resolve);
    case "equals":
    case "predicate":
      return false;
  }
}

function hasLifecycleRole(
  capabilities: MojoLifecycleCapabilities,
  role: MojoLifecycleTraitRole,
): boolean {
  switch (role) {
    case "copyable": return capabilities.copy !== "unavailable";
    case "implicitly-copyable": return capabilities.copy === "implicit";
    case "movable": return capabilities.movable;
    case "deinitializable": return capabilities.deinitializable;
    case "register-passable": return capabilities.registerPassing !== "unavailable";
    case "trivial-register-passable": return capabilities.registerPassing === "trivial";
  }
}

function genericTypeArgument(
  argument: MojoTargetGenericArgument | undefined,
): MojoTargetTypeRef | undefined {
  return argument?.kind === "type" ? argument.type : undefined;
}

function aggregateLifecycle(
  members: readonly MojoLifecycleCapabilities[],
  implicitWhenPossible: boolean,
  explicitDestruction = false,
): MojoLifecycleCapabilities {
  const copy = members.every((member) => member.copy === "implicit") && implicitWhenPossible
    ? "implicit"
    : members.every((member) => member.copy !== "unavailable") ? "explicit" : "unavailable";
  const registerPassing = members.every((member) => member.registerPassing === "trivial")
    ? "trivial"
    : members.every((member) => member.registerPassing !== "unavailable")
      ? "register"
      : "unavailable";
  return lifecycle(
    copy,
    members.every((member) => member.movable),
    members.every((member) => member.deinitializable),
    registerPassing,
    explicitDestruction,
  );
}

function lifecycle(
  copy: MojoLifecycleCapabilities["copy"],
  movable: boolean,
  deinitializable: boolean,
  registerPassing: MojoRegisterPassingCapability,
  explicitDestruction = false,
): MojoLifecycleCapabilities {
  return Object.freeze({ copy, movable, deinitializable, registerPassing, explicitDestruction });
}

function visitType(
  type: MojoTargetTypeRef,
  resolve: (type: MojoTargetTypeRef) => MojoLifecycleCapabilities,
): void {
  resolve(type);
  switch (type.kind) {
    case "list":
    case "fixed-array":
      visitType(type.element, resolve);
      return;
    case "optional":
      visitType(type.value, resolve);
      return;
    case "dictionary":
      visitType(type.key, resolve);
      visitType(type.value, resolve);
      return;
    case "future":
      visitType(type.output, resolve);
      return;
    case "union":
      for (const member of type.members) visitType(member, resolve);
      return;
    case "tuple":
      for (const element of type.elements) visitType(element, resolve);
      return;
    case "associated":
      visitType(type.owner, resolve);
      for (const argument of type.genericArguments) {
        const child = genericTypeArgument(argument);
        if (child !== undefined) visitType(child, resolve);
      }
      return;
    case "target-named":
      for (const argument of type.genericArguments ?? []) {
        const child = genericTypeArgument(argument);
        if (child !== undefined) visitType(child, resolve);
      }
      return;
    case "reference":
      visitType(type.value, resolve);
      return;
    case "callable":
      for (const parameter of type.parameters) visitType(parameter.type, resolve);
      visitType(type.result, resolve);
      if (type.errorType !== undefined) visitType(type.errorType, resolve);
      return;
    case "function":
      for (const parameter of type.genericParameters) {
        for (const constraint of parameter.constraints) visitType(constraint, resolve);
        const defaultType = genericTypeArgument(parameter.defaultArgument);
        if (defaultType !== undefined) visitType(defaultType, resolve);
      }
      for (const parameter of type.parameters) visitType(parameter.type, resolve);
      visitType(type.result, resolve);
      if (type.errorType !== undefined) visitType(type.errorType, resolve);
      return;
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
  }
}
