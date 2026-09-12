import type { ProviderTypeExpression } from "@tsonic/tsts";
import type { MojoOriginRef } from "../../../target-model/origins/model.js";
import { mojoSourceOriginTypeIds } from "../../../source/semantics/declarations/origins.js";
import { mojoTypesModule } from "../../../source/semantics/identity.js";

export function mojoProviderOriginSourceType(
  origin: MojoOriginRef,
  imports: Map<string, Set<string>>,
): ProviderTypeExpression {
  if (origin.kind === "parameter") return Object.freeze({ kind: "type-parameter", name: origin.name });
  if (origin.kind === "provider-expression") {
    throw new Error("Mojo provider origin expression has no exact source origin parameter projection.");
  }
  const exportName = origin.kind === "static"
    ? mojoSourceOriginTypeIds.staticOrigin
    : origin.kind === "untracked"
      ? mojoSourceOriginTypeIds.untrackedOrigin
      : origin.kind === "unsafe"
        ? mojoSourceOriginTypeIds.unsafeOrigin
        : mojoSourceOriginTypeIds.inferredOrigin;
  return mojoProviderSourceType(exportName, [], imports);
}

export function mojoProviderSourceType(
  exportName: string,
  typeArguments: readonly ProviderTypeExpression[],
  imports: Map<string, Set<string>>,
): ProviderTypeExpression {
  const names = imports.get(mojoTypesModule) ?? new Set<string>();
  names.add(exportName);
  imports.set(mojoTypesModule, names);
  return Object.freeze({
    kind: "provider-ref",
    moduleSpecifier: mojoTypesModule,
    exportName,
    ...(typeArguments.length === 0 ? {} : { typeArguments: Object.freeze([...typeArguments]) }),
  });
}
