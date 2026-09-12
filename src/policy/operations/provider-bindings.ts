import { mojoTargetGenericArgumentsEqual, mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoOriginEquals } from "../../target-model/origins/identity.js";
import type { MojoOriginRef } from "../../target-model/origins/model.js";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "../../target-model/types/model.js";

export interface MojoProviderBindings {
  readonly types: Map<string, MojoTargetTypeRef>;
  readonly values: Map<string, MojoTargetGenericArgument>;
  readonly origins: Map<string, MojoOriginRef>;
  readonly packs: Map<string, readonly MojoTargetGenericArgument[]>;
}

export function bindTargetTypePattern(
  pattern: MojoTargetTypeRef,
  actual: MojoTargetTypeRef,
  bindings: MojoProviderBindings,
): string | undefined {
  if (pattern.kind === "type-parameter") {
    const existing = bindings.types.get(pattern.name);
    if (existing !== undefined && !mojoTargetTypeEquals(existing, actual)) return `type parameter '${pattern.name}' received contradictory carriers`;
    bindings.types.set(pattern.name, actual);
    return undefined;
  }
  if (pattern.kind !== actual.kind) return `'${pattern.kind}' does not match '${actual.kind}'`;
  if (pattern.kind === "target-named" && actual.kind === "target-named") {
    if (pattern.id !== actual.id) return "target type identities differ";
    return bindArguments(pattern.genericArguments ?? [], actual.genericArguments ?? [], bindings);
  }
  if (pattern.kind === "reference" && actual.kind === "reference") {
    if (pattern.mutable !== actual.mutable) return "reference mutability differs";
    return bindOrigin(pattern.origin, actual.origin, bindings) ?? bindTargetTypePattern(pattern.value, actual.value, bindings);
  }
  if (pattern.kind === "associated" && actual.kind === "associated") {
    if (pattern.memberPath.length !== actual.memberPath.length || pattern.memberPath.some((part, index) => part !== actual.memberPath[index])) return "associated member identities differ";
    return bindTargetTypePattern(pattern.owner, actual.owner, bindings) ?? bindArguments(pattern.genericArguments, actual.genericArguments, bindings);
  }
  if (pattern.kind === "list" && actual.kind === "list") return bindTargetTypePattern(pattern.element, actual.element, bindings);
  if (pattern.kind === "fixed-array" && actual.kind === "fixed-array") {
    if (pattern.length.kind === "parameter") {
      const value: MojoTargetGenericArgument = actual.length.kind === "parameter"
        ? { kind: "value-reference", path: [actual.length.name] } : actual.length;
      const mismatch = bindArguments([{ kind: "value-reference", path: [pattern.length.name] }], [value], bindings);
      if (mismatch !== undefined) return mismatch;
    } else if (JSON.stringify(pattern.length) !== JSON.stringify(actual.length)) return "fixed-array lengths differ";
    return bindTargetTypePattern(pattern.element, actual.element, bindings);
  }
  if (pattern.kind === "dictionary" && actual.kind === "dictionary") return bindTargetTypePattern(pattern.key, actual.key, bindings) ?? bindTargetTypePattern(pattern.value, actual.value, bindings);
  if (pattern.kind === "future" && actual.kind === "future") {
    if (pattern.domain !== actual.domain || pattern.raises !== actual.raises || pattern.captureOrigins !== actual.captureOrigins) return "future contracts differ";
    return bindTargetTypePattern(pattern.output, actual.output, bindings);
  }
  if (pattern.kind === "optional" && actual.kind === "optional") return bindTargetTypePattern(pattern.value, actual.value, bindings);
  if (pattern.kind === "tuple" && actual.kind === "tuple") return bindTypes(pattern.elements, actual.elements, bindings);
  if (pattern.kind === "union" && actual.kind === "union") return bindTypes(pattern.members, actual.members, bindings);
  return mojoTargetTypeEquals(pattern, actual) ? undefined : "closed provider carriers differ";
}

function bindTypes(patterns: readonly MojoTargetTypeRef[], actuals: readonly MojoTargetTypeRef[], bindings: MojoProviderBindings): string | undefined {
  if (patterns.length !== actuals.length) return "type arities differ";
  for (const [index, pattern] of patterns.entries()) {
    const mismatch = bindTargetTypePattern(pattern, actuals[index]!, bindings);
    if (mismatch !== undefined) return mismatch;
  }
  return undefined;
}

function bindArguments(patterns: readonly MojoTargetGenericArgument[], actuals: readonly MojoTargetGenericArgument[], bindings: MojoProviderBindings): string | undefined {
  if (patterns.length !== actuals.length) return "target generic arities differ";
  for (const [index, pattern] of patterns.entries()) {
    const actual = actuals[index]!;
    if (pattern.kind === "unbound") continue;
    if (pattern.name !== actual.name) return "target generic argument positions differ";
    if (pattern.kind === "type" && actual.kind === "type") {
      const mismatch = bindTargetTypePattern(pattern.type, actual.type, bindings);
      if (mismatch !== undefined) return mismatch;
    } else if (pattern.kind === "origin" && actual.kind === "origin") {
      const mismatch = bindOrigin(pattern.origin, actual.origin, bindings);
      if (mismatch !== undefined) return mismatch;
    } else if (pattern.kind === "value-reference" && pattern.path.length === 1) {
      const name = pattern.path[0]!;
      const existing = bindings.values.get(name);
      if (existing !== undefined && !mojoTargetGenericArgumentsEqual([existing], [actual])) return `value parameter '${name}' received contradictory arguments`;
      bindings.values.set(name, actual);
    } else if (!mojoTargetGenericArgumentsEqual([pattern], [actual])) return "non-type generic arguments differ";
  }
  return undefined;
}

function bindOrigin(pattern: MojoOriginRef, actual: MojoOriginRef, bindings: MojoProviderBindings): string | undefined {
  if (pattern.kind !== "parameter") return mojoOriginEquals(pattern, actual) ? undefined : "reference origins differ";
  const existing = bindings.origins.get(pattern.name);
  if (existing !== undefined && !mojoOriginEquals(existing, actual)) return `origin parameter '${pattern.name}' received contradictory origins`;
  bindings.origins.set(pattern.name, actual);
  return undefined;
}
