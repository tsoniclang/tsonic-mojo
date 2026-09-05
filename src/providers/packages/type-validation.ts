import type {
  MojoTargetConformanceCondition,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoOriginRef } from "../../target-model/origins/model.js";
import type {
  MojoLifecycleTraitRole,
  MojoNamedLifecycleContract,
} from "../../target-model/lifecycle/model.js";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const lifecycleTraitRoles: ReadonlySet<MojoLifecycleTraitRole> = new Set([
  "copyable",
  "implicitly-copyable",
  "movable",
  "deinitializable",
  "register-passable",
  "trivial-register-passable",
]);

export function validateMojoProviderType(type: MojoTargetTypeRef): void {
  switch (type.kind) {
    case "source-primitive":
      if (type.name === "decimal" || type.name === "int128" || type.name === "uint128") {
        throw new Error(`Source primitive '${type.name}' has no certified Mojo carrier.`);
      }
      return;
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "bigint":
    case "symbol":
    case "dynamic":
      return;
    case "compiler-expression":
      requireText(type.expression, "Mojo compiler-owned type expression");
      return;
    case "type-parameter":
      if (!identifierPattern.test(type.name)) throw new Error(`Invalid Mojo type parameter '${type.name}'.`);
      validateLifecycleRoles(type.lifecycleRequirements, `type parameter '${type.name}'`);
      return;
    case "target-named":
      requireText(type.id, "target type id");
      if (!identifierPattern.test(type.name) || type.modulePath.some((part) => !identifierPattern.test(part))) {
        throw new Error(`Target type '${type.id}' has an invalid Mojo path.`);
      }
      for (const argument of type.genericArguments ?? []) {
        validateMojoProviderGenericArgument(argument, `target type '${type.id}'`);
      }
      if (type.lifecycle !== undefined && type.lifecycleRequirement !== undefined) {
        throw new Error(`Target type '${type.id}' cannot be both a lifecycle carrier and a lifecycle requirement.`);
      }
      if (type.lifecycleRequirement !== undefined) {
        validateMojoLifecycleRole(type.lifecycleRequirement, `target type '${type.id}'`);
      }
      if (type.lifecycle !== undefined) validateNamedLifecycle(type.lifecycle, type, `target type '${type.id}'`);
      return;
    case "list":
      validateMojoProviderType(type.element);
      return;
    case "fixed-array":
      validateMojoProviderType(type.element);
      if (type.length.kind === "integer") {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(type.length.value)) {
          throw new Error(`Mojo fixed-array length '${type.length.value}' is not a canonical non-negative integer.`);
        }
      } else if (type.length.kind === "parameter" && !identifierPattern.test(type.length.name)) {
        throw new Error(`Mojo fixed-array length parameter '${type.length.name}' is invalid.`);
      }
      return;
    case "dictionary":
      validateMojoProviderType(type.key);
      validateMojoProviderType(type.value);
      return;
    case "future":
      validateMojoProviderType(type.output);
      return;
    case "optional":
      validateMojoProviderType(type.value);
      return;
    case "union":
      if (type.members.length < 2) throw new Error("Mojo union target type requires at least two member carriers.");
      for (const member of type.members) validateMojoProviderType(member);
      return;
    case "tuple":
      for (const element of type.elements) validateMojoProviderType(element);
      return;
    case "associated":
      validateMojoProviderType(type.owner);
      if (type.memberPath.length === 0 || type.memberPath.some((part) => !identifierPattern.test(part))) {
        throw new Error("Mojo associated target type has an invalid member path.");
      }
      for (const argument of type.genericArguments) {
        validateMojoProviderGenericArgument(argument, "associated target type");
      }
      return;
    case "reference":
      validateOrigin(type.origin);
      validateMojoProviderType(type.value);
      return;
    case "callable":
      for (const parameter of type.parameters) {
        if (parameter.name !== undefined && !identifierPattern.test(parameter.name)) {
          throw new Error(`Invalid Mojo callable parameter '${parameter.name}'.`);
        }
        validateMojoProviderType(parameter.type);
      }
      validateMojoProviderType(type.result);
      if (type.errorType !== undefined) validateMojoProviderType(type.errorType);
      return;
    case "function":
      for (const parameter of type.genericParameters) {
        if (!identifierPattern.test(parameter.name)) {
          throw new Error(`Invalid Mojo function generic parameter '${parameter.name}'.`);
        }
        for (const constraint of parameter.constraints) validateMojoProviderType(constraint);
        if (parameter.defaultArgument !== undefined) {
          validateMojoProviderGenericArgument(parameter.defaultArgument);
        }
      }
      for (const parameter of type.parameters) {
        if (parameter.name !== undefined && !identifierPattern.test(parameter.name)) {
          throw new Error(`Invalid Mojo function parameter '${parameter.name}'.`);
        }
        validateMojoProviderType(parameter.type);
      }
      validateMojoProviderType(type.result);
      if (type.errorType !== undefined) validateMojoProviderType(type.errorType);
      if (type.capture !== undefined) requireText(type.capture, "function capture origin");
      return;
  }
}

export function validateMojoConformanceCondition(
  condition: MojoTargetConformanceCondition,
  exportId: string,
): void {
  switch (condition.kind) {
    case "boolean": return;
    case "conforms-to":
      if (!identifierPattern.test(condition.subject) || condition.traitNames.length === 0 ||
        condition.traitNames.some((name) => !identifierPattern.test(name))) {
        throw new Error(`Provider type '${exportId}' has an invalid conforms-to condition.`);
      }
      return;
    case "predicate":
      validateConditionValue(condition.value, exportId);
      return;
    case "equals":
      validateConditionValue(condition.left, exportId);
      validateConditionValue(condition.right, exportId);
      return;
    case "not":
      validateMojoConformanceCondition(condition.operand, exportId);
      return;
    case "all":
    case "any":
      if (condition.operands.length < 2) {
        throw new Error(`Provider type '${exportId}' has a degenerate boolean conformance condition.`);
      }
      for (const operand of condition.operands) validateMojoConformanceCondition(operand, exportId);
      return;
    case "conditional":
      validateMojoConformanceCondition(condition.condition, exportId);
      validateMojoConformanceCondition(condition.whenTrue, exportId);
      validateMojoConformanceCondition(condition.whenFalse, exportId);
      return;
  }
}

export function validateMojoProviderGenericArgument(
  argument: MojoTargetGenericArgument,
  owner = "provider operation",
): void {
  if (argument.name !== undefined && !identifierPattern.test(argument.name)) {
    throw new Error(`Mojo ${owner} has an invalid named generic argument.`);
  }
  if (argument.kind === "type") validateMojoProviderType(argument.type);
  else if (argument.kind === "type-expression" || argument.kind === "compiler-expression") {
    requireText(argument.expression, "target generic value");
  } else if (argument.kind === "static-string") {
    requireText(argument.value, "target static-string generic value");
  } else if (argument.kind === "integer") {
    if (!/^-?[0-9]+$/u.test(argument.value)) {
      throw new Error("Mojo target integer generic value is not an exact integer literal.");
    }
  } else if (argument.kind === "value-reference" &&
    (argument.path.length === 0 || argument.path.some((part) => !identifierPattern.test(part)))) {
    throw new Error("Mojo target generic value reference is not an exact identifier path.");
  }
}

export function validateMojoLifecycleRole(role: MojoLifecycleTraitRole, owner: string): void {
  if (!lifecycleTraitRoles.has(role)) throw new Error(`Mojo ${owner} has an invalid lifecycle conformance role.`);
}

function validateLifecycleRoles(roles: readonly MojoLifecycleTraitRole[] | undefined, owner: string): void {
  const seen = new Set<MojoLifecycleTraitRole>();
  for (const role of roles ?? []) {
    if (!lifecycleTraitRoles.has(role) || seen.has(role)) {
      throw new Error(`Mojo ${owner} has an invalid or duplicate lifecycle requirement '${role}'.`);
    }
    seen.add(role);
  }
}

function validateNamedLifecycle(
  lifecycle: MojoNamedLifecycleContract,
  type: Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>,
  owner: string,
): void {
  if (lifecycle.kind === "fixed") {
    if (!new Set(["implicit", "explicit", "unavailable"]).has(lifecycle.capabilities.copy) ||
      !new Set(["trivial", "register", "unavailable"]).has(lifecycle.capabilities.registerPassing) ||
      typeof lifecycle.capabilities.movable !== "boolean" ||
      typeof lifecycle.capabilities.deinitializable !== "boolean" ||
      typeof lifecycle.capabilities.explicitDestruction !== "boolean") {
      throw new Error(`Mojo ${owner} has an invalid fixed lifecycle contract.`);
    }
    return;
  }
  const indexes = new Set<number>();
  const arguments_ = type.genericArguments ?? [];
  for (const index of lifecycle.genericArgumentIndexes) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= arguments_.length ||
      arguments_[index]?.kind !== "type" || indexes.has(index)) {
      throw new Error(`Mojo ${owner} has an invalid aggregate lifecycle argument index '${index}'.`);
    }
    indexes.add(index);
  }
  if (typeof lifecycle.implicitCopyWhenPossible !== "boolean" ||
    typeof lifecycle.explicitDestruction !== "boolean") {
    throw new Error(`Mojo ${owner} has an invalid aggregate lifecycle contract.`);
  }
}

function validateOrigin(origin: MojoOriginRef): void {
  switch (origin.kind) {
    case "static":
    case "comptime":
    case "inferred": return;
    case "untracked":
    case "unsafe":
      if (typeof origin.mutable !== "boolean") throw new Error("Mojo reference origin has no exact mutability.");
      return;
    case "parameter":
      if (!identifierPattern.test(origin.name)) throw new Error(`Invalid Mojo origin parameter '${origin.name}'.`);
      return;
    case "provider-expression":
      if (origin.tokens.length === 0 || origin.tokens.some((token) => token.text.length === 0)) {
        throw new Error("Mojo provider origin expression must contain exact non-empty tokens.");
      }
      return;
  }
}

function validateConditionValue(
  value: import("../../target-model/types/model.js").MojoTargetConditionValue,
  exportId: string,
): void {
  const path = value.kind === "path" ? value.segments : value.receiver;
  if (path.length === 0 || path.some((part) => !identifierPattern.test(part)) ||
    (value.kind === "generic-call" &&
      (value.typeArguments.length === 0 || value.typeArguments.some((part) => !identifierPattern.test(part))))) {
    throw new Error(`Provider type '${exportId}' has an invalid conformance condition value.`);
  }
}

function requireText(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Provider ${field} must be non-empty text.`);
  }
}
