import type { ProviderTypeExpression } from "@tsonic/tsts";
import type { MojoOriginRef } from "../../../target-model/origins/model.js";
import { mojoSourceOriginTypeIds } from "../../../source/semantics/declarations/origins.js";
import { mojoTypesModule } from "../../../source/semantics/identity.js";
import type { MojoCompilerGenericParameter } from "../model/model.js";

export function mojoCompilerOriginMutability(parameter: MojoCompilerGenericParameter): boolean | undefined {
  if (parameter.constraints.length === 0) return undefined;
  const constraint = parameter.constraints.length === 1 ? parameter.constraints[0] : undefined;
  if (constraint?.kind === "named") {
    if (constraint.path === "/std/origin/#mutorigin" && constraint.name === "MutOrigin" && constraint.arguments.length === 0) return true;
    if (constraint.path === "/std/origin/#immorigin" && constraint.name === "ImmOrigin" && constraint.arguments.length === 0) return false;
    if (constraint.name === "Origin" && (constraint.path === undefined || constraint.path === "/std/origin/Origin")) {
      if (constraint.arguments.length === 0) return undefined;
      const argument = constraint.arguments.length === 1 ? constraint.arguments[0] : undefined;
      if (argument?.kind === "value" && argument.name === "mut") {
        if (argument.expression === "True") return true;
        if (argument.expression === "False") return false;
        if (argument.expression === `${parameter.name}.mut`) return undefined;
      }
    }
  }
  throw new Error(`Mojo origin parameter '${parameter.name}' has no exact supported mutability constraint.`);
}

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
