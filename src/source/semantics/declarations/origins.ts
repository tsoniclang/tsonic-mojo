import type {
  ProviderExportDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import { mojoTypesModule } from "../identity.js";

export const mojoSourceOriginTypeIds = Object.freeze({
  origin: "Origin",
  staticOrigin: "StaticOrigin",
  inferredOrigin: "InferredOrigin",
  untrackedOrigin: "UntrackedOrigin",
  unsafeOrigin: "UnsafeOrigin",
  reference: "Ref",
  mutableReference: "MutRef",
});

export function mojoSourceOriginDeclarations(): readonly ProviderExportDeclaration[] {
  const origin = mojoType(mojoSourceOriginTypeIds.origin);
  const inferredOrigin = mojoType(mojoSourceOriginTypeIds.inferredOrigin);
  const value = typeParameter("T");
  const originParameter: ProviderTypeParameterDeclaration = Object.freeze({
    name: "O",
    constraints: [origin],
    defaultType: inferredOrigin,
  });
  return [
    alias(mojoSourceOriginTypeIds.origin, { kind: "unknown" }),
    alias(mojoSourceOriginTypeIds.staticOrigin, origin),
    alias(mojoSourceOriginTypeIds.inferredOrigin, origin),
    alias(mojoSourceOriginTypeIds.untrackedOrigin, origin),
    alias(mojoSourceOriginTypeIds.unsafeOrigin, origin),
    genericAlias(
      mojoSourceOriginTypeIds.reference,
      [Object.freeze({ name: "T" }), originParameter],
      value,
    ),
    genericAlias(
      mojoSourceOriginTypeIds.mutableReference,
      [Object.freeze({ name: "T" }), originParameter],
      value,
    ),
  ];
}

function typeParameter(name: string): ProviderTypeExpression {
  return Object.freeze({ kind: "type-parameter", name });
}

function mojoType(exportName: string): ProviderTypeExpression {
  return Object.freeze({
    kind: "provider-ref",
    moduleSpecifier: mojoTypesModule,
    exportName,
  });
}

function alias(name: string, type: ProviderTypeExpression): ProviderExportDeclaration {
  return Object.freeze({ id: name, name, kind: "type", type });
}

function genericAlias(
  name: string,
  typeParameters: readonly ProviderTypeParameterDeclaration[],
  type: ProviderTypeExpression,
): ProviderExportDeclaration {
  return Object.freeze({
    id: name,
    name,
    kind: "type",
    typeParameters,
    type,
  });
}
