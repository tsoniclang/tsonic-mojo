import type { ProviderTypeExpression } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoSourceOriginTypeIds } from "../../source/semantics/declarations/origins.js";
import { mojoTypesModule } from "../../source/semantics/identity.js";

export function mojoProviderSourceResultContract(
  source: ProviderTypeExpression | undefined,
  target: MojoTargetTypeRef,
  pattern: MojoTargetTypeRef,
): "value" | "exact-value" | "reference" | "conflict" {
  if (source?.kind === "type-parameter" && pattern.kind === "type-parameter" && source.name === pattern.name) return "exact-value";
  if (source?.kind === "source-primitive" && pattern.kind === "source-primitive" && source.name === pattern.name) return "exact-value";
  if (source?.kind !== "provider-ref" || source.moduleSpecifier !== mojoTypesModule ||
    (source.exportName !== mojoSourceOriginTypeIds.reference && source.exportName !== mojoSourceOriginTypeIds.mutableReference)) return "value";
  if (target.kind !== "reference" || target.mutable !== (source.exportName === mojoSourceOriginTypeIds.mutableReference)) return "conflict";
  if (pattern.kind !== "reference") return "conflict";
  const origin = source.typeArguments?.[1];
  if (origin?.kind === "type-parameter" && (pattern.origin.kind !== "parameter" || pattern.origin.name !== origin.name)) return "conflict";
  if (origin?.kind === "provider-ref") {
    if (origin.moduleSpecifier !== mojoTypesModule) return "conflict";
    const expected = origin.exportName === mojoSourceOriginTypeIds.staticOrigin ? "static"
      : origin.exportName === mojoSourceOriginTypeIds.untrackedOrigin ? "untracked"
        : origin.exportName === mojoSourceOriginTypeIds.unsafeOrigin ? "unsafe"
          : origin.exportName === mojoSourceOriginTypeIds.inferredOrigin ? "inferred" : undefined;
    if (expected === undefined || expected !== "inferred" && expected !== pattern.origin.kind) return "conflict";
  } else if (origin !== undefined && origin.kind !== "type-parameter") return "conflict";
  const value = source.typeArguments?.[0];
  if (value === undefined) return "conflict";
  if (value.kind === "source-primitive" && (target.value.kind !== "source-primitive" || target.value.name !== value.name)) return "conflict";
  if (value.kind === "string" && target.value.kind !== "native-string") return "conflict";
  if (value.kind === "type-parameter" && (pattern.value.kind !== "type-parameter" || pattern.value.name !== value.name)) return "conflict";
  return "reference";
}
