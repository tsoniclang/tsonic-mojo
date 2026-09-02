import {
  tsonicCoreNativePointerProviderNames,
  tsonicCoreProviderVersion,
  tsonicCoreTypesModule,
  tsonicCoreVirtualModulesProviderId,
} from "@tsonic/source-core/facts";
import type {
  MojoProviderSemantics,
  MojoProviderTypeRow,
} from "../packages/model.js";

export const mojoNativePointerTargetId = "tsonic.mojo.native-pointer";

const nativePointerType: MojoProviderTypeRow = Object.freeze({
  exportId: tsonicCoreNativePointerProviderNames.nativePointerExport,
  sourceGenericParameters: Object.freeze([Object.freeze({
    targetName: "T",
    targetKind: "type" as const,
    variadic: false,
  })]),
  targetType: Object.freeze({
    kind: "target-named" as const,
    id: mojoNativePointerTargetId,
    modulePath: Object.freeze(["std", "memory"]),
    name: "Pointer",
    genericArguments: Object.freeze([
      Object.freeze({
        kind: "type" as const,
        type: Object.freeze({ kind: "type-parameter" as const, name: "T" }),
      }),
      Object.freeze({
        kind: "compiler-expression" as const,
        expression: "MutUnsafeAnyOrigin",
      }),
    ]),
  }),
  providerPackageId: "tsonic-source-core",
  providerId: tsonicCoreVirtualModulesProviderId,
  providerVersion: tsonicCoreProviderVersion,
  providerModuleId: tsonicCoreTypesModule,
  moduleSpecifier: tsonicCoreTypesModule,
});

export function mojoBuiltInSourceTypeSemantics(): MojoProviderSemantics {
  return Object.freeze({
    exports: Object.freeze([]),
    operations: Object.freeze([]),
    types: Object.freeze([nativePointerType]),
    binaryEpilogues: Object.freeze([]),
  });
}
