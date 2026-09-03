import type { MojoCallArgumentConvention, MojoCallArgumentPosition } from "../../../target-model/types/model.js";
import type { MojoLifecycleTraitRole } from "../../../target-model/lifecycle/model.js";

export const mojoCompilerProviderProtocolVersion = 2;

export interface MojoCompilerToolIdentity {
  readonly version: string;
  readonly executablePath: string;
  readonly executableByteLength: number;
  readonly executableDigest: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly commandDigest: string;
  readonly environmentDigest: string;
}

export interface MojoCompilerModuleSource {
  readonly modulePath: readonly string[];
  readonly sourcePath: string;
  readonly byteLength: number;
  readonly digest: string;
}

export interface MojoCompilerPackageSnapshot {
  readonly kind: "standard-library" | "package";
  readonly id: string;
  readonly alias: string;
  readonly packageName: string;
  readonly version: string;
  readonly importRoot: string;
  readonly sourceRoot: string;
  readonly sourceDigest: string;
  readonly modules: readonly MojoCompilerModuleSource[];
}

export interface MojoCompilerProjectSnapshot {
  readonly protocolVersion: typeof mojoCompilerProviderProtocolVersion;
  readonly compiler: MojoCompilerToolIdentity;
  readonly languageServer: MojoCompilerToolIdentity;
  readonly packages: readonly MojoCompilerPackageSnapshot[];
  readonly digest: string;
}

export interface MojoCompilerNamedPath {
  readonly name: string;
  readonly path?: string;
  readonly condition?: MojoCompilerConformanceCondition;
}

export type MojoCompilerConformanceCondition =
  | { readonly kind: "boolean"; readonly value: boolean }
  | {
      readonly kind: "conforms-to";
      readonly subject: string;
      readonly traitNames: readonly string[];
      readonly lifecycleRoles?: readonly MojoLifecycleTraitRole[];
    }
  | { readonly kind: "predicate"; readonly value: MojoCompilerConditionValue }
  | {
      readonly kind: "equals";
      readonly left: MojoCompilerConditionValue;
      readonly right: MojoCompilerConditionValue;
    }
  | { readonly kind: "not"; readonly operand: MojoCompilerConformanceCondition }
  | { readonly kind: "all" | "any"; readonly operands: readonly MojoCompilerConformanceCondition[] }
  | {
      readonly kind: "conditional";
      readonly condition: MojoCompilerConformanceCondition;
      readonly whenTrue: MojoCompilerConformanceCondition;
      readonly whenFalse: MojoCompilerConformanceCondition;
    };

export type MojoCompilerConditionValue =
  | { readonly kind: "path"; readonly segments: readonly string[] }
  | {
      readonly kind: "generic-call";
      readonly receiver: readonly string[];
      readonly typeArguments: readonly string[];
    };

export type MojoCompilerType =
  | { readonly kind: "named"; readonly name: string; readonly path?: string; readonly arguments: readonly MojoCompilerTypeArgument[] }
  | { readonly kind: "type-parameter"; readonly name: string }
  | { readonly kind: "self"; readonly memberPath: readonly string[]; readonly arguments: readonly MojoCompilerTypeArgument[] }
  | {
      readonly kind: "associated";
      readonly owner: MojoCompilerType;
      readonly memberPath: readonly string[];
      readonly arguments: readonly MojoCompilerTypeArgument[];
    }
  | { readonly kind: "tuple"; readonly elements: readonly MojoCompilerType[] }
  | { readonly kind: "reference"; readonly origin: string; readonly target: MojoCompilerType }
  | { readonly kind: "compiler-expression"; readonly expression: string }
  | {
      readonly kind: "function";
      readonly genericParameters: readonly MojoCompilerGenericParameter[];
      readonly parameters: readonly MojoCompilerCallableParameter[];
      readonly result?: MojoCompilerType;
      readonly asynchronous: boolean;
      readonly thin: boolean;
      readonly raises: boolean;
      readonly errorType?: MojoCompilerType;
      readonly capture?: string;
    };

export interface MojoCompilerCallableParameter {
  readonly name?: string;
  readonly convention: MojoCallArgumentConvention;
  readonly type: MojoCompilerType;
}

export type MojoCompilerTypeArgument =
  | { readonly kind: "type"; readonly name?: string; readonly type: MojoCompilerType }
  | { readonly kind: "type-expression"; readonly name?: string; readonly sourceType: MojoCompilerType; readonly expression: string }
  | { readonly kind: "compiler-expression"; readonly name?: string; readonly expression: string }
  | { readonly kind: "value"; readonly name?: string; readonly expression: string }
  | { readonly kind: "unbound"; readonly name?: string };

export interface MojoCompilerGenericParameter {
  readonly kind: "type" | "value" | "origin";
  readonly name: string;
  readonly passingKind: "positional" | "positional-or-keyword" | "keyword" | "inferred";
  readonly variadic: boolean;
  readonly constraints: readonly MojoCompilerType[];
  readonly defaultArgument?: MojoCompilerTypeArgument;
}

export interface MojoCompilerFunctionArgument {
  readonly name: string;
  readonly convention: MojoCallArgumentConvention;
  readonly position: MojoCallArgumentPosition;
  readonly type: MojoCompilerType;
  readonly defaultValue?: string;
  readonly variadic: boolean;
}

export interface MojoCompilerFunction {
  readonly identity: string;
  readonly name: string;
  readonly genericParameters: readonly MojoCompilerGenericParameter[];
  readonly arguments: readonly MojoCompilerFunctionArgument[];
  readonly result?: MojoCompilerType;
  readonly raises: boolean;
  readonly asynchronous: boolean;
  readonly static: boolean;
  readonly implicitConversion: boolean;
  readonly requiredImplementation: boolean;
  readonly documentation?: string;
}

export interface MojoCompilerField {
  readonly identity: string;
  readonly name: string;
  readonly type: MojoCompilerType;
  readonly documentation?: string;
}

export interface MojoCompilerAssociatedAlias {
  readonly identity: string;
  readonly name: string;
  readonly genericParameters: readonly MojoCompilerGenericParameter[];
  readonly category: "type" | "value" | "origin";
  readonly abstract: boolean;
  readonly targetType?: MojoCompilerType;
  readonly valueType?: MojoCompilerType;
  readonly valueExpression?: string;
  readonly documentation?: string;
}

export interface MojoCompilerStruct {
  readonly kind: "struct";
  readonly identity: string;
  readonly name: string;
  readonly genericParameters: readonly MojoCompilerGenericParameter[];
  readonly convention: string;
  readonly parentTraits: readonly MojoCompilerNamedPath[];
  readonly aliases: readonly MojoCompilerAssociatedAlias[];
  readonly fields: readonly MojoCompilerField[];
  readonly functions: readonly MojoCompilerFunction[];
  readonly documentation?: string;
}

export interface MojoCompilerTrait {
  readonly kind: "trait";
  readonly identity: string;
  readonly name: string;
  readonly parentTraits: readonly MojoCompilerNamedPath[];
  readonly aliases: readonly MojoCompilerAssociatedAlias[];
  readonly fields: readonly MojoCompilerField[];
  readonly functions: readonly MojoCompilerFunction[];
  readonly documentation?: string;
}

export interface MojoCompilerAlias {
  readonly kind: "alias";
  readonly identity: string;
  readonly name: string;
  readonly genericParameters: readonly MojoCompilerGenericParameter[];
  readonly category: "type" | "value" | "origin";
  readonly targetType?: MojoCompilerType;
  readonly valueType?: MojoCompilerType;
  readonly valueExpression: string;
  readonly documentation?: string;
}

export type MojoCompilerTypeDeclaration =
  | MojoCompilerStruct
  | MojoCompilerTrait
  | MojoCompilerAlias;

export interface MojoCompilerModuleModel {
  readonly protocolVersion: typeof mojoCompilerProviderProtocolVersion;
  readonly packageId: string;
  readonly packageAlias: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly modulePath: readonly string[];
  readonly moduleIdentity: string;
  readonly sourceDigest: string;
  readonly documentVersion: string;
  readonly availableExports: readonly {
    readonly name: string;
    readonly kind: "function" | "struct" | "trait" | "alias";
  }[];
  readonly functions: readonly MojoCompilerFunction[];
  readonly declarations: readonly MojoCompilerTypeDeclaration[];
}
