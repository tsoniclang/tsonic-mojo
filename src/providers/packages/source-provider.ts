import {
  TstsSourceProviderContractVersion,
} from "@tsonic/tsts";
import type {
  CompilerExtension,
  ExtensionInitializeContext,
  ProviderDeclarationModel,
  ProviderExportDeclaration,
  ProviderMemberDeclaration,
  ProviderModuleResolution,
  ProviderParameterDeclaration,
  ProviderSignatureDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import { materializeClosedMetadata } from "./closed-data.js";
import type { MojoProviderPackageDefinition } from "./model.js";

export function createMojoProviderPackageSourceExtension(
  definition: MojoProviderPackageDefinition,
): CompilerExtension {
  return Object.freeze({
    identity: Object.freeze({
      id: `tsonic.mojo.provider-package.${definition.id}`,
      version: definition.version,
    }),
    initialize(context: ExtensionInitializeContext): void {
      context.registerSourceDeclarationProvider(
        createMojoProviderPackageSourceProvider(definition),
      );
    },
  });
}

export function createMojoProviderPackageSourceProvider(
  definition: MojoProviderPackageDefinition,
): SourceDeclarationProvider {
  const modulesBySpecifier = new Map(
    definition.modules.map((module) => [module.moduleSpecifier, module]),
  );
  const canonicalByPublic = new Map<string, string>(
    definition.modules.map((module) => [module.moduleSpecifier, module.moduleSpecifier]),
  );
  for (const alias of definition.moduleAliases ?? []) {
    canonicalByPublic.set(alias.moduleSpecifier, alias.canonicalModuleSpecifier);
  }
  const providerId = mojoProviderBindingProviderId(definition.id);
  return Object.freeze({
    identity: Object.freeze({
      id: providerId,
      version: definition.version,
      extensionContractVersion: TstsSourceProviderContractVersion,
    }),
    declarationMaterialization: "complete",
    ownsModule(specifier: string) {
      return canonicalByPublic.has(specifier)
        ? Object.freeze({ kind: "owned" as const })
        : Object.freeze({ kind: "unowned" as const });
    },
    resolveModule(specifier: string) {
      const canonical = canonicalByPublic.get(specifier);
      const module = canonical === undefined ? undefined : modulesBySpecifier.get(canonical);
      if (module === undefined) {
        return Object.freeze({
          extensionId: `tsonic.mojo.provider-package.${definition.id}`,
          extensionCode: "MOJO_PROVIDER_MODULE_NOT_OWNED",
          numericCode: 9_501_001,
          category: "error" as const,
          message: `Mojo provider package '${definition.id}' does not own '${specifier}'.`,
        });
      }
      return Object.freeze({
        kind: "virtual" as const,
        moduleSpecifier: specifier,
        virtualFileName: `/tsonic-mojo/${encodeURIComponent(definition.id)}/${encodeURIComponent(specifier)}.d.ts`,
        providerModuleId: module.providerModuleId,
        packageName: specifier,
        packageVersion: definition.version,
      });
    },
    getDeclarationModel(resolution: ProviderModuleResolution): ProviderDeclarationModel {
      const canonical = canonicalByPublic.get(resolution.moduleSpecifier);
      const module = canonical === undefined ? undefined : modulesBySpecifier.get(canonical);
      if (module === undefined) {
        throw new Error(`Mojo provider package '${definition.id}' cannot materialize unowned module '${resolution.moduleSpecifier}'.`);
      }
      if (resolution.providerModuleId !== module.providerModuleId) {
        throw new Error(`Mojo provider module '${resolution.moduleSpecifier}' resolved as '${resolution.providerModuleId}', expected '${module.providerModuleId}'.`);
      }
      return materializeClosedMetadata({
        moduleSpecifier: resolution.moduleSpecifier,
        providerModuleId: module.providerModuleId,
        ...(module.imports === undefined ? {} : { imports: module.imports }),
        exports: module.exports.map((declaration) => rebaseExport(
          declaration,
          module.moduleSpecifier,
          resolution.moduleSpecifier,
        )),
      });
    },
  });
}

function rebaseExport(
  declaration: ProviderExportDeclaration,
  canonical: string,
  publicSpecifier: string,
): ProviderExportDeclaration {
  const mapType = (type: ProviderTypeExpression): ProviderTypeExpression =>
    rebaseType(type, canonical, publicSpecifier);
  return {
    ...declaration,
    ...(declaration.type === undefined ? {} : { type: mapType(declaration.type) }),
    ...(declaration.typeParameters === undefined
      ? {}
      : { typeParameters: declaration.typeParameters.map((parameter) => rebaseTypeParameter(parameter, mapType)) }),
    ...(declaration.heritage === undefined
      ? {}
      : { heritage: declaration.heritage.map((entry) => ({ ...entry, type: mapType(entry.type) })) }),
    ...(declaration.signatures === undefined
      ? {}
      : { signatures: declaration.signatures.map((signature) => rebaseSignature(signature, mapType)) }),
    ...(declaration.members === undefined
      ? {}
      : { members: declaration.members.map((member) => rebaseMember(member, mapType)) }),
  };
}

function rebaseMember(
  member: ProviderMemberDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderMemberDeclaration {
  return {
    ...member,
    ...(member.type === undefined ? {} : { type: mapType(member.type) }),
    ...(member.signatures === undefined
      ? {}
      : { signatures: member.signatures.map((signature) => rebaseSignature(signature, mapType)) }),
  };
}

function rebaseSignature(
  signature: ProviderSignatureDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderSignatureDeclaration {
  return {
    ...signature,
    parameters: signature.parameters.map((parameter) => rebaseParameter(parameter, mapType)),
    ...(signature.returnType === undefined ? {} : { returnType: mapType(signature.returnType) }),
    ...(signature.typeParameters === undefined
      ? {}
      : { typeParameters: signature.typeParameters.map((parameter) => rebaseTypeParameter(parameter, mapType)) }),
  };
}

function rebaseParameter(
  parameter: ProviderParameterDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderParameterDeclaration {
  return {
    ...parameter,
    type: mapType(parameter.type),
    ...(parameter.defaultType === undefined ? {} : { defaultType: mapType(parameter.defaultType) }),
  };
}

function rebaseTypeParameter(
  parameter: ProviderTypeParameterDeclaration,
  mapType: (type: ProviderTypeExpression) => ProviderTypeExpression,
): ProviderTypeParameterDeclaration {
  return {
    ...parameter,
    ...(parameter.constraints === undefined ? {} : { constraints: parameter.constraints.map(mapType) }),
    ...(parameter.defaultType === undefined ? {} : { defaultType: mapType(parameter.defaultType) }),
  };
}

function rebaseType(
  type: ProviderTypeExpression,
  canonical: string,
  publicSpecifier: string,
): ProviderTypeExpression {
  const mapType = (nested: ProviderTypeExpression): ProviderTypeExpression =>
    rebaseType(nested, canonical, publicSpecifier);
  switch (type.kind) {
    case "provider-ref":
      return {
        ...type,
        moduleSpecifier: type.moduleSpecifier === canonical ? publicSpecifier : type.moduleSpecifier,
        ...(type.typeArguments === undefined ? {} : { typeArguments: type.typeArguments.map(mapType) }),
      };
    case "source-global":
      return {
        ...type,
        ...(type.typeArguments === undefined ? {} : { typeArguments: type.typeArguments.map(mapType) }),
      };
    case "array":
      return { ...type, elementType: mapType(type.elementType) };
    case "tuple":
      return { ...type, elementTypes: type.elementTypes.map(mapType) };
    case "union":
    case "intersection":
      return { ...type, types: type.types.map(mapType) };
    case "function":
      return {
        ...type,
        parameters: type.parameters.map((parameter) => rebaseParameter(parameter, mapType)),
        returnType: mapType(type.returnType),
        ...(type.typeParameters === undefined
          ? {}
          : { typeParameters: type.typeParameters.map((parameter) => rebaseTypeParameter(parameter, mapType)) }),
      };
    case "any":
    case "unknown":
    case "void":
    case "never":
    case "undefined":
    case "boolean":
    case "string":
    case "number":
    case "bigint":
    case "object":
    case "literal":
    case "source-primitive":
    case "type-parameter":
      return type;
  }
}

export function mojoProviderBindingProviderId(packageId: string): string {
  return `tsonic.mojo.provider-package.${packageId}.binding`;
}
