import { TstsSourceProviderContractVersion } from "@tsonic/tsts";
import type {
  ExtensionDiagnostic,
  ProviderDeclarationModel,
  ProviderDeclarationRequest,
  ProviderModuleResolution,
  SourceDeclarationProvider,
} from "@tsonic/tsts";
import type { MojoTargetConfiguration } from "../../target-model/configuration/model.js";
import type {
  MojoProviderModuleDefinition,
  MojoProviderOperationDefinition,
  MojoProviderSemantics,
  MojoProviderTypeDefinition,
} from "../packages/model.js";
import {
  collectMojoProviderSemanticsFromDefinitions,
  mergeMojoProviderSemantics,
} from "../packages/semantics.js";
import { mojoProviderBindingProviderId } from "../packages/source-provider.js";
import { materializeClosedMetadata } from "../packages/closed-data.js";
import type {
  MojoCompilerModuleSource,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
} from "./model/model.js";
import { createMojoCompilerProjectSnapshot } from "./snapshot/source-snapshot.js";
import {
  createMojoCompilerMetadataLoader,
} from "./mojo-doc.js";
import type { MojoCompilerMetadataLoader } from "./mojo-doc.js";
import { resolveMojoCompilerModuleSpecifier } from "./projection/module-specifier.js";
import { projectMojoCompilerModule } from "./projection/projection.js";
import { mergeMojoCompilerProjections } from "./projection/merge.js";
import type { MojoCompilerProviderProjection } from "./projection/model.js";

const diagnosticCodes = Object.freeze({
  MOJO_COMPILER_PROVIDER_MODULE_UNOWNED: 9_502_001,
  MOJO_COMPILER_PROVIDER_IDENTITY_CONFLICT: 9_502_002,
  MOJO_COMPILER_PROVIDER_DECLARATION_FAILED: 9_502_003,
});
type DiagnosticCode = keyof typeof diagnosticCodes;

export interface MojoCompilerProviderSession {
  readonly sourceProviders: readonly SourceDeclarationProvider[];
  readonly runtimePackages: readonly {
    readonly packageName: string;
    readonly packagePath: string;
  }[];
  semantics(): MojoProviderSemantics;
  close(): void;
}

export function createMojoCompilerProviderSession(
  configuration: MojoTargetConfiguration,
  dependencies: {
    readonly snapshot?: MojoCompilerProjectSnapshot;
    readonly loader?: MojoCompilerMetadataLoader;
  } = {},
): MojoCompilerProviderSession {
  if (configuration.compilerProvider.packages.length === 0) {
    return emptySession();
  }
  const snapshot = dependencies.snapshot ?? createMojoCompilerProjectSnapshot(
    configuration.compilerProvider,
    configuration.toolchainVersion,
  );
  const loader = dependencies.loader ?? createMojoCompilerMetadataLoader();
  const registries = snapshot.packages.map((package_) => createProjectionRegistry(snapshot, package_));
  const sourceProviders = snapshot.packages.map((package_, index) => createCompilerProvider({
    snapshot,
    package: package_,
    loader,
    registry: registries[index]!,
  }));
  let state: "open" | "sealed" | "closed" = "open";
  let sealedSemantics: MojoProviderSemantics | undefined;
  return Object.freeze({
    sourceProviders: Object.freeze(sourceProviders),
    runtimePackages: Object.freeze(snapshot.packages
      .filter(({ kind }) => kind === "package")
      .map((package_) => Object.freeze({
        packageName: package_.packageName,
        packagePath: loader.runtimeImportRoot({ snapshot, package: package_ }),
      }))),
    semantics(): MojoProviderSemantics {
      if (state === "closed") throw new Error("Mojo compiler-provider session is closed.");
      if (sealedSemantics === undefined) {
        sealedSemantics = mergeMojoProviderSemantics(...registries.map((registry) => registry.semantics()));
        state = "sealed";
      }
      return sealedSemantics;
    },
    close(): void {
      if (state === "closed") return;
      for (const registry of registries) registry.close();
      loader.close();
      sealedSemantics = undefined;
      state = "closed";
    },
  });
}

function emptySession(): MojoCompilerProviderSession {
  const semantics = Object.freeze({
    exports: Object.freeze([]),
    operations: Object.freeze([]),
    types: Object.freeze([]),
    binaryEpilogues: Object.freeze([]),
  });
  let closed = false;
  return Object.freeze({
    sourceProviders: Object.freeze([]),
    runtimePackages: Object.freeze([]),
    semantics(): MojoProviderSemantics {
      if (closed) throw new Error("Mojo compiler-provider session is closed.");
      return semantics;
    },
    close(): void { closed = true; },
  });
}

function createCompilerProvider(options: {
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly loader: MojoCompilerMetadataLoader;
  readonly registry: ProjectionRegistry;
}): SourceDeclarationProvider {
  const package_ = options.package;
  const providerId = mojoProviderBindingProviderId(package_.id);
  const providerVersion = `${package_.version}+${options.snapshot.digest}`;
  return Object.freeze({
    identity: Object.freeze({
      id: providerId,
      version: providerVersion,
      extensionContractVersion: TstsSourceProviderContractVersion,
      configHash: options.snapshot.digest,
      displayName: `Mojo compiler provider for ${package_.packageName}`,
    }),
    declarationMaterialization: "incremental",
    ownsModule(specifier: string) {
      const resolved = resolveMojoCompilerModuleSpecifier(options.snapshot, specifier);
      return resolved?.package.id === package_.id
        ? Object.freeze({ kind: "owned" as const })
        : Object.freeze({ kind: "unowned" as const });
    },
    resolveModule(specifier: string) {
      const resolved = resolveMojoCompilerModuleSpecifier(options.snapshot, specifier);
      if (resolved?.package.id !== package_.id) {
        return diagnostic(
          providerId,
          "MOJO_COMPILER_PROVIDER_MODULE_UNOWNED",
          `Mojo compiler package '${package_.id}' does not own '${specifier}'.`,
        );
      }
      return Object.freeze({
        kind: "virtual" as const,
        moduleSpecifier: specifier,
        virtualFileName: `tsts-provider://tsonic-mojo/compiler/${encodeURIComponent(package_.alias)}/${resolved.modulePath.length === 0 ? "index" : resolved.modulePath.map(encodeURIComponent).join("/")}.d.ts`,
        providerModuleId: providerModuleId(package_, resolved.modulePath),
        packageName: package_.packageName,
        packageVersion: package_.version,
      });
    },
    getDeclarationModel(
      resolution: ProviderModuleResolution,
      request: ProviderDeclarationRequest,
    ): ProviderDeclarationModel | ExtensionDiagnostic {
      const resolved = resolveMojoCompilerModuleSpecifier(options.snapshot, resolution.moduleSpecifier);
      if (resolved?.package.id !== package_.id) {
        return diagnostic(
          providerId,
          "MOJO_COMPILER_PROVIDER_MODULE_UNOWNED",
          `Mojo compiler package '${package_.id}' cannot materialize '${resolution.moduleSpecifier}'.`,
        );
      }
      const expectedModuleId = providerModuleId(package_, resolved.modulePath);
      if (resolution.providerModuleId !== expectedModuleId) {
        return diagnostic(
          providerId,
          "MOJO_COMPILER_PROVIDER_IDENTITY_CONFLICT",
          `Mojo module '${resolution.moduleSpecifier}' resolved as '${resolution.providerModuleId}', expected '${expectedModuleId}'.`,
        );
      }
      const module = findModule(package_, resolved.modulePath);
      try {
        const requestedExports = requestedExportNames(request);
        const projection = requestedExports === undefined
          ? projectCompleteModule({
              snapshot: options.snapshot,
              package: package_,
              module,
              loader: options.loader,
              providerModuleId: expectedModuleId,
              moduleSpecifier: resolution.moduleSpecifier,
            })
          : projectRequestedExports({
              snapshot: options.snapshot,
              package: package_,
              module,
              loader: options.loader,
              providerModuleId: expectedModuleId,
              moduleSpecifier: resolution.moduleSpecifier,
              exportNames: requestedExports,
            });
        options.registry.add(projection);
        return materializeClosedMetadata(projection.declarationModel);
      } catch (error) {
        return diagnostic(
          providerId,
          "MOJO_COMPILER_PROVIDER_DECLARATION_FAILED",
          `Mojo module '${resolution.moduleSpecifier}' cannot be represented: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  });
}

function projectCompleteModule(options: {
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
  readonly loader: MojoCompilerMetadataLoader;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}): MojoCompilerProviderProjection {
  const exportNames = options.loader.listExports({
    snapshot: options.snapshot,
    package: options.package,
    module: options.module,
  });
  return projectRequestedExports({
    snapshot: options.snapshot,
    package: options.package,
    module: options.module,
    loader: options.loader,
    providerModuleId: options.providerModuleId,
    moduleSpecifier: options.moduleSpecifier,
    exportNames,
  });
}

function projectRequestedExports(options: {
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly module: MojoCompilerModuleSource;
  readonly loader: MojoCompilerMetadataLoader;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
  readonly exportNames: readonly string[];
}): MojoCompilerProviderProjection {
  const projections = options.loader.resolveExports({
    snapshot: options.snapshot,
    package: options.package,
    module: options.module,
    exportNames: options.exportNames,
  }).map((resolved) => {
    const model = options.loader.module({
      snapshot: options.snapshot,
      package: resolved.package,
      module: resolved.module,
      requestedExports: [resolved.declarationName],
    });
    return projectMojoCompilerModule(options.snapshot, resolved.package, model, {
      providerModuleId: options.providerModuleId,
      moduleSpecifier: options.moduleSpecifier,
      exports: [Object.freeze({
        declarationName: resolved.declarationName,
        exportName: resolved.exportName,
      })],
    });
  });
  return mergeMojoCompilerProjections(
    options.moduleSpecifier,
    options.providerModuleId,
    projections,
  );
}

interface ProjectionRegistry {
  add(projection: MojoCompilerProviderProjection): void;
  semantics(): MojoProviderSemantics;
  close(): void;
}

function createProjectionRegistry(
  snapshot: MojoCompilerProjectSnapshot,
  package_: MojoCompilerPackageSnapshot,
): ProjectionRegistry {
  const modules = new Map<string, {
    readonly providerModuleId: string;
    readonly exports: Map<string, MojoProviderModuleDefinition["exports"][number]>;
    readonly imports: Map<string, Set<string>>;
  }>();
  const operations = new Map<string, MojoProviderOperationDefinition>();
  const types = new Map<string, MojoProviderTypeDefinition>();
  let state: "open" | "sealed" | "closed" = "open";
  let sealed: MojoProviderSemantics | undefined;
  return Object.freeze({
    add(projection: MojoCompilerProviderProjection): void {
      if (state !== "open") throw new Error("Mojo compiler-provider registry is sealed.");
      const model = projection.declarationModel;
      const current = modules.get(model.moduleSpecifier);
      if (current !== undefined && current.providerModuleId !== model.providerModuleId) {
        throw new Error(`Mojo compiler module '${model.moduleSpecifier}' has conflicting identities.`);
      }
      validateExactBatch(
        current?.exports ?? new Map(),
        model.exports.map((value) => [value.id, value] as const),
        "export",
      );
      validateExactBatch(
        operations,
        projection.operations.map((value) => [operationIdentity(value), value] as const),
        "operation",
      );
      validateExactBatch(
        types,
        projection.types.map((value) => [value.exportId, value] as const),
        "type",
      );
      const module = current ?? {
        providerModuleId: model.providerModuleId,
        exports: new Map(),
        imports: new Map(),
      };
      modules.set(model.moduleSpecifier, module);
      for (const exported of model.exports) addExact(module.exports, exported.id, exported, "export");
      for (const imported of model.imports ?? []) {
        const names = module.imports.get(imported.moduleSpecifier) ?? new Set<string>();
        module.imports.set(imported.moduleSpecifier, names);
        for (const named of imported.namedImports ?? []) names.add(named.exportedName);
      }
      for (const operation of projection.operations) {
        addExact(operations, operationIdentity(operation), operation, "operation");
      }
      for (const type of projection.types) addExact(types, type.exportId, type, "type");
    },
    semantics(): MojoProviderSemantics {
      if (state === "closed") throw new Error("Mojo compiler-provider registry is closed.");
      if (sealed !== undefined) return sealed;
      state = "sealed";
      const definition = Object.freeze({
        id: package_.id,
        displayName: `Mojo compiler provider for ${package_.packageName}`,
        version: `${package_.version}+${snapshot.digest}`,
        modules: Object.freeze([...modules.entries()]
          .sort(([left], [right]) => compareText(left, right))
          .map(([moduleSpecifier, module]): MojoProviderModuleDefinition => Object.freeze({
            moduleSpecifier,
            providerModuleId: module.providerModuleId,
            ...(module.imports.size === 0
              ? {}
              : {
                  imports: Object.freeze([...module.imports.entries()]
                    .sort(([left], [right]) => compareText(left, right))
                    .map(([importSpecifier, names]) => Object.freeze({
                      moduleSpecifier: importSpecifier,
                      namedImports: Object.freeze([...names].sort(compareText)
                        .map((exportedName) => Object.freeze({ exportedName }))),
                    }))),
                }),
            exports: Object.freeze([...module.exports.values()]),
          }))),
        types: Object.freeze([...types.values()]),
        operations: Object.freeze([...operations.values()]),
        runtimePackages: Object.freeze([]),
      });
      sealed = collectMojoProviderSemanticsFromDefinitions([definition]);
      return sealed;
    },
    close(): void {
      for (const module of modules.values()) {
        module.exports.clear();
        for (const names of module.imports.values()) names.clear();
        module.imports.clear();
      }
      modules.clear();
      operations.clear();
      types.clear();
      sealed = undefined;
      state = "closed";
    },
  });
}

function validateExactBatch<T>(
  existing: ReadonlyMap<string, T>,
  values: readonly (readonly [string, T])[],
  kind: string,
): void {
  const pending = new Map<string, T>();
  for (const [identity, value] of values) {
    const prior = pending.get(identity) ?? existing.get(identity);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(value)) {
      throw new Error(`Mojo compiler-provider ${kind} '${identity}' has conflicting projections.`);
    }
    pending.set(identity, value);
  }
}

function requestedExportNames(request: ProviderDeclarationRequest): readonly string[] | undefined {
  if (request.materialization.kind === "complete" || request.context.importSlice?.broadImport === true) {
    return undefined;
  }
  const names = new Set([
    ...(request.context.importSlice?.requestedExports ?? []).map(({ exportedName }) => exportedName),
    ...request.materialization.completeExports.map(({ exportName }) => exportName),
  ]);
  return Object.freeze([...names].sort(compareText));
}

function findModule(
  package_: MojoCompilerPackageSnapshot,
  modulePath: readonly string[],
): MojoCompilerModuleSource {
  const module = package_.modules.find((candidate) => samePath(candidate.modulePath, modulePath));
  if (module === undefined) throw new Error(`Mojo package '${package_.id}' has no module '${modulePath.join(".")}'.`);
  return module;
}

function providerModuleId(package_: MojoCompilerPackageSnapshot, modulePath: readonly string[]): string {
  return `${package_.id}:${package_.sourceDigest}:${modulePath.join(".")}`;
}

function addExact<T>(map: Map<string, T>, identity: string, value: T, kind: string): void {
  const existing = map.get(identity);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
    throw new Error(`Mojo compiler-provider ${kind} '${identity}' has conflicting projections.`);
  }
  map.set(identity, value);
}

function operationIdentity(operation: MojoProviderOperationDefinition): string {
  return `${operation.exportId}\0${operation.memberId ?? ""}\0${operation.signatureId ?? ""}\0${operation.operationKind}`;
}

function diagnostic(extensionId: string, code: DiagnosticCode, message: string): ExtensionDiagnostic {
  return Object.freeze({
    extensionId,
    extensionCode: code,
    numericCode: diagnosticCodes[code],
    category: "error" as const,
    message,
  });
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
