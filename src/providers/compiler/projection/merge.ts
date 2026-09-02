import type {
  ProviderExportDeclaration,
  ProviderImportDeclaration,
} from "@tsonic/tsts";
import type {
  MojoProviderOperationDefinition,
  MojoProviderTypeDefinition,
} from "../../packages/model.js";
import type { MojoCompilerProviderProjection } from "./model.js";

export function mergeMojoCompilerProjections(
  moduleSpecifier: string,
  providerModuleId: string,
  projections: readonly MojoCompilerProviderProjection[],
): MojoCompilerProviderProjection {
  const imports = new Map<string, Set<string>>();
  const exports = new Map<string, ProviderExportDeclaration>();
  const operations = new Map<string, MojoProviderOperationDefinition>();
  const types = new Map<string, MojoProviderTypeDefinition>();
  for (const projection of projections) {
    if (projection.declarationModel.moduleSpecifier !== moduleSpecifier ||
      projection.declarationModel.providerModuleId !== providerModuleId) {
      throw new Error(`Mojo compiler projection does not belong to '${moduleSpecifier}'.`);
    }
    for (const imported of projection.declarationModel.imports ?? []) {
      const names = imports.get(imported.moduleSpecifier) ?? new Set<string>();
      imports.set(imported.moduleSpecifier, names);
      for (const named of imported.namedImports ?? []) names.add(named.exportedName);
    }
    for (const exported of projection.declarationModel.exports) {
      addExact(exports, exported.id, exported, "export");
    }
    for (const operation of projection.operations) {
      addExact(operations, operationIdentity(operation), operation, "operation");
    }
    for (const type of projection.types) addExact(types, type.exportId, type, "type");
  }
  const declarationImports: ProviderImportDeclaration[] = [...imports.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([importSpecifier, names]) => Object.freeze({
      moduleSpecifier: importSpecifier,
      namedImports: Object.freeze([...names].sort(compareText)
        .map((exportedName) => Object.freeze({ exportedName }))),
    }));
  return Object.freeze({
    declarationModel: Object.freeze({
      moduleSpecifier,
      providerModuleId,
      ...(declarationImports.length === 0 ? {} : { imports: Object.freeze(declarationImports) }),
      exports: Object.freeze([...exports.values()].sort((left, right) =>
        compareText(sourceExportName(left), sourceExportName(right)))),
    }),
    operations: Object.freeze([...operations.values()]),
    types: Object.freeze([...types.values()]),
  });
}

function addExact<T>(
  values: Map<string, T>,
  identity: string,
  value: T,
  kind: string,
): void {
  const existing = values.get(identity);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error(`Mojo compiler projection ${kind} '${identity}' conflicts during merge.`);
  }
  values.set(identity, value);
}

function operationIdentity(operation: MojoProviderOperationDefinition): string {
  return `${operation.exportId}\0${operation.memberId ?? ""}\0${operation.signatureId ?? ""}\0${operation.operationKind}`;
}

function sourceExportName(declaration: ProviderExportDeclaration): string {
  return declaration.exportName ?? declaration.name;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
