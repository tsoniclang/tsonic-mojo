import type {
  ProviderDeclarationKind,
  ProviderExportDeclaration,
} from "@tsonic/tsts";
import type {
  TargetCapabilityContribution,
  TargetCapabilityImplementation,
} from "@tsonic/target-api/provider";
import type {
  MojoTargetConformanceCondition,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type {
  MojoProviderOperationForm,
} from "../../target-model/operations/model.js";

export interface MojoProviderModuleDefinition {
  readonly moduleSpecifier: string;
  readonly providerModuleId: string;
  readonly imports?: readonly {
    readonly moduleSpecifier: string;
    readonly namedImports: readonly { readonly exportedName: string }[];
  }[];
  readonly exports: readonly ProviderExportDeclaration[];
}

export interface MojoProviderModuleAlias {
  readonly moduleSpecifier: string;
  readonly canonicalModuleSpecifier: string;
}

export interface MojoProviderRuntimePackage {
  readonly packageName: string;
  readonly packagePath: string;
}

export interface MojoProviderBinaryEpilogue {
  readonly id: string;
  readonly modulePath: readonly string[];
  readonly name: string;
  readonly raises?: boolean;
}

export interface MojoProviderTypeDefinition {
  readonly exportId: string;
  readonly sourceGenericParameters: readonly {
    readonly targetName: string;
    readonly targetKind: "type" | "value" | "origin";
    readonly variadic: boolean;
  }[];
  readonly targetType: MojoTargetTypeRef;
  readonly conformances?: readonly {
    readonly trait: MojoTargetTypeRef;
    readonly condition?: MojoTargetConformanceCondition;
  }[];
  readonly associatedAliases?: readonly {
    readonly name: string;
    readonly genericParameters: readonly import("../../target-model/types/model.js").MojoProviderTargetGenericParameter[];
    readonly category: "type" | "value" | "origin";
    readonly abstract: boolean;
    readonly targetType?: MojoTargetTypeRef;
    readonly valueType?: MojoTargetTypeRef;
    readonly valueExpression?: string;
  }[];
  readonly objectLiteralConstruction?: {
    readonly kind: "struct-default";
  };
}

export type MojoProviderOperationKind =
  | "call"
  | "constructor"
  | "property"
  | "property-set"
  | "indexer"
  | "index-set";

export interface MojoProviderOperationDefinition {
  readonly exportId: string;
  readonly memberId?: string;
  readonly signatureId?: string;
  readonly operationKind: MojoProviderOperationKind;
  readonly target: MojoProviderOperationForm;
  readonly resultType: MojoTargetTypeRef;
  readonly parameterTypes?: readonly MojoTargetTypeRef[];
  readonly receiverType?: MojoTargetTypeRef;
  readonly raises?: boolean;
}

export interface MojoProviderPackageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly requiredSurfaces?: readonly string[];
  readonly moduleAliases?: readonly MojoProviderModuleAlias[];
  readonly modules: readonly MojoProviderModuleDefinition[];
  readonly types?: readonly MojoProviderTypeDefinition[];
  readonly operations: readonly MojoProviderOperationDefinition[];
  readonly binaryEpilogues?: readonly MojoProviderBinaryEpilogue[];
  readonly runtimePackages: readonly MojoProviderRuntimePackage[];
}

export interface MojoProviderExportRow {
  readonly exportId: string;
  readonly declarationKind: ProviderDeclarationKind;
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
}

export type MojoProviderOperationRow = MojoProviderOperationDefinition & {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
};

export type MojoProviderTypeRow = MojoProviderTypeDefinition & {
  readonly providerPackageId: string;
  readonly providerId: string;
  readonly providerVersion: string;
  readonly providerModuleId: string;
  readonly moduleSpecifier: string;
};

export interface MojoProviderSemantics {
  readonly exports: readonly MojoProviderExportRow[];
  readonly operations: readonly MojoProviderOperationRow[];
  readonly types: readonly MojoProviderTypeRow[];
  readonly binaryEpilogues: readonly MojoProviderBinaryEpilogue[];
}

export const mojoProviderPolicyContributionKind = "mojo-provider-policy";

export interface MojoProviderPolicyContribution extends TargetCapabilityContribution {
  readonly kind: typeof mojoProviderPolicyContributionKind;
  readonly contractVersion: 1;
  readonly definition: MojoProviderPackageDefinition;
}

export type MojoProviderPackageImplementation = TargetCapabilityImplementation;
