import type { AstReader, Node, Type } from "@tsonic/tsts";
import type { MojoProviderTypeRow } from "../../providers/packages/model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { resolveMojoNonTypeGenericArguments } from "./generic-arguments.js";
import { authoredTypeArguments } from "./resolution-helpers.js";
import type { MojoTypeResolution } from "./resolution.js";

interface ProviderTypeInstantiationContext {
  readonly ast: AstReader;
  readonly semantics: import("@tsonic/target-api/source").SourceFileSemantics;
}

type NestedTypeResolver = (
  selectedType: Type | undefined,
  authoredTypeNode: Node | undefined,
  resolving: Set<Type>,
) => MojoTypeResolution;

export function instantiateMojoProviderType(
  row: MojoProviderTypeRow,
  selectedType: Type,
  authoredTypeNode: Node | undefined,
  context: ProviderTypeInstantiationContext,
  resolving: Set<Type>,
  resolveNested: NestedTypeResolver,
): MojoTypeResolution {
  const sourceArguments = context.semantics.types.effectiveTypeArguments(selectedType) ??
    context.semantics.types.typeArguments(selectedType);
  if (sourceArguments.length !== row.sourceGenericParameters.length) {
    return {
      kind: "unsupported",
      reason: `selected provider type supplies ${sourceArguments.length} generic arguments for ${row.sourceGenericParameters.length} exact Mojo parameters`,
    };
  }
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const valueSubstitutions = new Map<string, MojoTargetGenericArgument>();
  const packSubstitutions = new Map<string, readonly MojoTargetGenericArgument[]>();
  const authoredArguments = authoredTypeArguments(authoredTypeNode, context.ast);
  for (const [index, parameter] of row.sourceGenericParameters.entries()) {
    const sourceArgument = sourceArguments[index]!;
    const authoredArgument = authoredArguments.length === sourceArguments.length
      ? authoredArguments[index]
      : undefined;
    if (parameter.targetKind !== "type") {
      if (authoredArgument === undefined) {
        return {
          kind: "unsupported",
          reason: `Mojo ${parameter.targetKind} parameter '${parameter.targetName}' has no exact authored source argument`,
        };
      }
      const arguments_ = resolveMojoNonTypeGenericArguments({
        kind: parameter.targetKind,
        name: parameter.targetName,
        position: "positional",
        variadic: parameter.variadic,
        constraints: Object.freeze([]),
      }, authoredArgument, context.ast);
      if (arguments_ === undefined || arguments_.length === 0 ||
        (!parameter.variadic && arguments_.length !== 1)) {
        return {
          kind: "unsupported",
          reason: `Mojo ${parameter.targetKind} parameter '${parameter.targetName}' has no closed source generic-value evidence`,
        };
      }
      if (parameter.variadic) packSubstitutions.set(parameter.targetName, arguments_);
      else valueSubstitutions.set(parameter.targetName, arguments_[0]!);
      continue;
    }
    const resolved = resolveNested(sourceArgument, authoredArgument, resolving);
    if (resolved.kind === "unsupported") return resolved;
    if (parameter.variadic) {
      if (resolved.type.kind !== "tuple") {
        return {
          kind: "unsupported",
          reason: `Mojo variadic type parameter '${parameter.targetName}' requires one exact tuple pack`,
        };
      }
      packSubstitutions.set(parameter.targetName, Object.freeze(resolved.type.elements.map((type) =>
        Object.freeze({ kind: "type" as const, type }))));
    } else {
      typeSubstitutions.set(parameter.targetName, resolved.type);
    }
  }
  return {
    kind: "resolved",
    type: substituteMojoTargetType(row.targetType, {
      types: typeSubstitutions,
      values: valueSubstitutions,
      packs: packSubstitutions,
    }),
  };
}
