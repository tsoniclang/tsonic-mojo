import { sourceSemanticsExtensionId } from "@tsonic/tsts";
import type {
  CompilerExtension,
  ExtensionInitializeContext,
  ProviderExportDeclaration,
  SourceAnalysisContext,
} from "@tsonic/tsts";
import {
  createSourceSemanticsVirtualModuleProvider,
  providerExportDeclarationsForSemanticsModule,
} from "@tsonic/source-core/extension";
import { mojoSourceSemanticsModules } from "../profiles/source-modules.js";
import {
  analyzeMojoSourceValueOperations,
} from "../semantics/analysis/operations.js";
import {
  mojoSourceOperationDeclarations,
} from "../semantics/declarations/operations.js";
import {
  mojoSourceOriginDeclarations,
} from "../semantics/declarations/origins.js";
import {
  mojoLangModule,
  mojoSourceProviderVersion,
  mojoSourceSemanticsExtensionId,
  mojoSourceVirtualModulesProviderId,
  mojoTypesModule,
} from "../semantics/identity.js";

export function createMojoSourceSemanticsExtension(
  additionalProviders: readonly import("@tsonic/tsts").SourceDeclarationProvider[] = Object.freeze([]),
): CompilerExtension {
  return Object.freeze({
    identity: Object.freeze({
      id: mojoSourceSemanticsExtensionId,
      version: mojoSourceProviderVersion,
    }),
    dependencies: Object.freeze({
      dependsOn: Object.freeze([sourceSemanticsExtensionId]),
      runsAfter: Object.freeze([sourceSemanticsExtensionId]),
    }),
    initialize(context: ExtensionInitializeContext): void {
      context.registerSourceDeclarationProvider(
        createSourceSemanticsVirtualModuleProvider({
          id: mojoSourceVirtualModulesProviderId,
          version: mojoSourceProviderVersion,
          displayName: "Tsonic Mojo source alias modules",
          virtualDirectory: "mojo-source",
          modules: mojoSourceSemanticsModules(),
          exportsForModule(module): readonly ProviderExportDeclaration[] {
            return Object.freeze([
              ...providerExportDeclarationsForSemanticsModule(module),
              ...(module.moduleSpecifier === mojoLangModule
                ? mojoSourceOperationDeclarations()
                : []),
              ...(module.moduleSpecifier === mojoTypesModule
                ? mojoSourceOriginDeclarations()
                : []),
            ]);
          },
          evidenceMessage:
            "Mojo target supplies source alias semantics as a complete virtual module.",
          diagnostics: Object.freeze({
            unowned: Object.freeze({
              extensionCode: "MOJO_SOURCE_MODULE_UNOWNED",
              numericCode: 9_500_001,
            }),
            declarationMissing: Object.freeze({
              extensionCode: "MOJO_SOURCE_MODULE_DECLARATION_MISSING",
              numericCode: 9_500_002,
            }),
          }),
        }),
      );
      for (const provider of additionalProviders) {
        context.registerSourceDeclarationProvider(provider);
      }
    },
    analyzeSource(context: SourceAnalysisContext): void {
      analyzeMojoSourceValueOperations(context);
    },
  });
}
