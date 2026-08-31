import { sourceSemanticsExtensionId } from "@tsonic/tsts";
import type { CompilerExtension, ExtensionInitializeContext } from "@tsonic/tsts";
import {
  createSourceSemanticsVirtualModuleProvider,
  providerExportDeclarationsForSemanticsModule,
} from "@tsonic/source-core/extension";
import { mojoSourceSemanticsModules } from "../profiles/source-modules.js";
import {
  mojoSourceProviderVersion,
  mojoSourceSemanticsExtensionId,
  mojoSourceVirtualModulesProviderId,
} from "../semantics/identity.js";

export function createMojoSourceSemanticsExtension(): CompilerExtension {
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
          exportsForModule: providerExportDeclarationsForSemanticsModule,
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
    },
  });
}
