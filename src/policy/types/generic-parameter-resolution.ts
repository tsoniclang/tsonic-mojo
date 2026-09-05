import type { Node, Type } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  classifyMojoSourceGenericParameter,
  mojoSourceGenericParameterOwner,
} from "../../source/semantics/generic-parameters.js";
import { mojoSourceGenericLifecycleRequirements } from "./generic-lifecycle.js";
import { resolveTypeParameter } from "./resolution-helpers.js";
import type { MojoTypeResolution, MojoTypeResolutionContext } from "./resolution.js";

export function resolveMojoGenericParameterType(
  selectedType: Type,
  symbol: ReturnType<MojoTypeResolutionContext["semantics"]["declarations"]["typeSymbol"]>,
  context: MojoTypeResolutionContext,
  resolving: Set<Type>,
  resolveNested: (
    selectedType: Type | undefined,
    authoredTypeNode: Node | undefined,
    resolving: Set<Type>,
  ) => MojoTypeResolution,
): MojoTypeResolution | undefined {
  const typeParameter = resolveTypeParameter(symbol, context);
  if (typeParameter === undefined) return undefined;
  const owner = mojoSourceGenericParameterOwner(typeParameter, context);
  if (owner === undefined) {
    return {
      kind: "unsupported",
      reason: "source generic parameter has no exact owning declaration",
    };
  }
  const classified = classifyMojoSourceGenericParameter(owner, typeParameter, context);
  if (classified.kind === "unsupported") {
    return { kind: "unsupported", reason: classified.reason };
  }
  if (classified.parameter.kind === "origin") {
    return {
      kind: "unsupported",
      reason: `origin parameter '${classified.parameter.name}' cannot be used as a runtime value carrier`,
    };
  }
  const constraintNode = context.ast.as.AsTypeParameterDeclaration(typeParameter)?.Constraint;
  if (classified.parameter.kind === "type") {
    const lifecycleRequirements = new Set<import("../../target-model/lifecycle/model.js").MojoLifecycleTraitRole>(
      mojoSourceGenericLifecycleRequirements(owner, selectedType, {
        source: context,
        semantics: context.semantics,
      }),
    );
    if (constraintNode !== undefined) {
      const constraintType = context.semantics.types.authoredType(constraintNode);
      const constraint = resolveNested(constraintType, constraintNode, resolving);
      if (constraint.kind === "unsupported") return constraint;
      if (constraint.type.kind === "target-named" &&
        constraint.type.lifecycleRequirement !== undefined) {
        lifecycleRequirements.add(constraint.type.lifecycleRequirement);
      }
    }
    const identity = sourceNodeIdentity(context.ast, typeParameter);
    if (identity === undefined) {
      return {
        kind: "unsupported",
        reason: `source type parameter '${classified.parameter.name}' has no stable declaration identity`,
      };
    }
    return {
      kind: "resolved",
      type: Object.freeze({
        kind: "type-parameter",
        name: classified.parameter.name,
        identity,
        lifecycleRequirements: Object.freeze([...lifecycleRequirements]),
      }),
    };
  }
  const constraintType = constraintNode === undefined
    ? undefined
    : context.semantics.types.authoredType(constraintNode);
  if (constraintType === undefined) {
    return {
      kind: "unsupported",
      reason: `compile-time value parameter '${classified.parameter.name}' has no exact value carrier constraint`,
    };
  }
  return resolveNested(constraintType, constraintNode, resolving);
}
