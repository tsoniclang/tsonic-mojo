import type { ProviderMemberDeclaration } from "@tsonic/tsts";
import type { MojoProviderPackageDefinition } from "./model.js";

export function validateMojoProviderSurfaceMembers(
  definition: MojoProviderPackageDefinition,
): readonly string[] {
  const identities = new Set<string>();
  const surfaces = new Set<string>();
  const declarations = new Map(definition.modules.flatMap((module) =>
    module.exports.map((entry) => [entry.id, entry] as const)));
  for (const slice of definition.surfaceMembers ?? []) {
    if (slice.id.trim().length === 0 || identities.has(slice.id)) {
      throw new Error(`Provider surface member identity '${slice.id}' is empty or duplicated.`);
    }
    identities.add(slice.id);
    if (slice.requiredSurfaces.length === 0 || new Set(slice.requiredSurfaces).size !== slice.requiredSurfaces.length) {
      throw new Error(`Provider surface members '${slice.id}' require distinct nonempty surfaces.`);
    }
    for (const surface of slice.requiredSurfaces) {
      if (surface.trim().length === 0) {
        throw new Error(`Provider surface members '${slice.id}' have an empty required surface.`);
      }
      surfaces.add(surface);
    }
    const memberOwners = new Map<string, string>();
    for (const group of slice.declarations) {
      const declaration = declarations.get(group.exportId);
      if (declaration === undefined || !["class", "interface"].includes(declaration.kind)) {
        throw new Error(`Provider surface members '${slice.id}' require a declared class/interface '${group.exportId}'.`);
      }
      for (const member of group.members) {
        if (memberOwners.has(member.id)) {
          throw new Error(`Provider surface member '${member.id}' is duplicated in '${slice.id}'.`);
        }
        memberOwners.set(member.id, group.exportId);
      }
    }
    for (const operation of slice.operations) {
      if (operation.memberId === undefined || memberOwners.get(operation.memberId) !== operation.exportId) {
        throw new Error(`Provider surface operation '${operation.memberId}' must belong to its own declared slice '${slice.id}'.`);
      }
    }
  }
  return Object.freeze([...surfaces].sort());
}

export function selectMojoProviderSurfaceMembers(
  definition: MojoProviderPackageDefinition,
  selectedSurfaces: readonly string[],
): MojoProviderPackageDefinition {
  const { surfaceMembers, ...base } = definition;
  if (surfaceMembers === undefined) return definition;
  const selected = new Set(selectedSurfaces);
  const slices = surfaceMembers.filter((slice) =>
    slice.requiredSurfaces.every((surface) => selected.has(surface)));
  const members = new Map<string, ProviderMemberDeclaration[]>();
  for (const slice of slices) {
    for (const group of slice.declarations) {
      const combined = members.get(group.exportId) ?? [];
      combined.push(...group.members);
      members.set(group.exportId, combined);
    }
  }
  return Object.freeze({
    ...base,
    modules: Object.freeze(base.modules.map((module) => Object.freeze({
      ...module,
      exports: Object.freeze(module.exports.map((declaration) => {
        const additional = members.get(declaration.id);
        return additional === undefined ? declaration : Object.freeze({
          ...declaration,
          members: Object.freeze([...(declaration.members ?? []), ...additional]),
        });
      })),
    }))),
    operations: Object.freeze([...base.operations, ...slices.flatMap((slice) => slice.operations)]),
  });
}
