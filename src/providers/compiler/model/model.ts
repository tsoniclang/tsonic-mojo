import type { MojoCallArgumentConvention, MojoCallArgumentPosition } from "../../../target-model/provider/model.js";

export const mojoCompilerProviderProtocolVersion = 1;

export interface MojoCompilerIdentity {
  readonly version: string;
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
  readonly compiler: MojoCompilerIdentity;
  readonly packages: readonly MojoCompilerPackageSnapshot[];
  readonly digest: string;
}

export interface MojoCompilerNamedPath {
  readonly name: string;
  readonly path?: string;
  readonly condition?: string;
}

export type MojoCompilerType =
  | { readonly kind: "named"; readonly name: string; readonly path?: string; readonly arguments: readonly MojoCompilerTypeArgument[] }
  | { readonly kind: "type-parameter"; readonly name: string }
  | { readonly kind: "self"; readonly memberPath: readonly string[] }
  | { readonly kind: "tuple"; readonly elements: readonly MojoCompilerType[] }
  | { readonly kind: "reference"; readonly origin: string; readonly target: MojoCompilerType }
  | {
      readonly kind: "function";
      readonly parameters: readonly MojoCompilerType[];
      readonly result?: MojoCompilerType;
      readonly thin: boolean;
      readonly raises: boolean;
      readonly errorType?: MojoCompilerType;
    };

export type MojoCompilerTypeArgument =
  | { readonly kind: "type"; readonly type: MojoCompilerType }
  | { readonly kind: "value"; readonly expression: string }
  | { readonly kind: "unbound" };

export interface MojoCompilerGenericParameter {
  readonly kind: "type" | "value" | "origin";
  readonly name: string;
  readonly passingKind: "positional" | "positional-or-keyword" | "inferred";
  readonly constraint: MojoCompilerType;
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
  readonly type?: MojoCompilerType;
  readonly value?: string;
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
  readonly type?: MojoCompilerType;
  readonly value?: string;
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
  readonly functions: readonly MojoCompilerFunction[];
  readonly declarations: readonly MojoCompilerTypeDeclaration[];
}
