import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetConfiguration } from "../../target-model/configuration/model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type {
  MojoValueConversion,
} from "../../target-model/conversions/model.js";
export type { MojoValueRefinementSelection } from "../refinements/model.js";
import type { MojoParameterDisposition } from "../representations/model.js";
export type {
  MojoArrayLiteralContribution,
  MojoArrayLiteralFixedSpreadSelection,
  MojoArrayLiteralFixedSpreadValue,
  MojoArrayLiteralSelection,
  MojoArrayLiteralSequenceSpreadSelection,
  MojoArrayLiteralValueSelection,
} from "../aggregates/model.js";
export type {
  MojoCallableCapture,
  MojoRecursiveCallableBinding,
  MojoCallableExpressionSelection,
  MojoTemplateStringConversion,
  MojoTemplateExpressionSelection,
  MojoBindingValueProjection,
  MojoBindingProjection,
  MojoBindingNormalization,
  MojoBindingProjectionPlan,
  MojoBindingPatternElementSelection,
  MojoBindingPatternSelection,
  MojoObjectLiteralContribution,
  MojoObjectLiteralSelection,
} from "./binding-and-object-model.js";
export type { MojoAnalyzedCallArgument, MojoCallSelection } from "./call-model.js";
import type { MojoCallableParameterAdapter } from "./dispatch-model.js";
import type { MojoAnalyzedModuleBinding } from "./module-model.js";

export interface MojoTargetAnalysisRequest {
  readonly input: TargetCompileInput;
  readonly configuration: MojoTargetConfiguration;
  readonly providerSemantics: MojoProviderSemantics;
  readonly jsEnabled: boolean;
}

export interface MojoAnalyzedParameter {
  readonly declaration: Node;
  readonly name: string;
  readonly incomingName: string;
  readonly type: MojoTargetTypeRef;
  readonly bodyType: MojoTargetTypeRef;
  readonly callType: MojoTargetTypeRef;
  readonly disposition: MojoParameterDisposition;
  readonly omissionKind: "required" | "undefined" | "initializer" | "rest";
  readonly initializer?: Node;
  readonly bindingPatternNode?: Node;
}

export interface MojoAnalyzedTypeParameter {
  readonly declaration: Node;
  readonly identity: string;
  readonly kind: "type" | "value" | "origin";
  readonly name: string;
  readonly position: "positional" | "positional-or-keyword" | "keyword" | "inferred";
  readonly variadic: boolean;
  readonly constraints: readonly MojoTargetTypeRef[];
  readonly defaultArgument?: import("../../target-model/types/model.js").MojoTargetGenericArgument;
}

export interface MojoAnalyzedClassOwner {
  readonly name: string;
  readonly stateName: string;
  readonly type: MojoTargetTypeRef;
}

export type MojoAnalyzedCallableKind =
  | "function"
  | "method"
  | "constructor"
  | "getter"
  | "setter";

export interface MojoAnalyzedCallableSignature {
  readonly kind: MojoAnalyzedCallableKind;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly implementationAdapterName?: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly asynchronous: boolean;
  readonly asyncDomain?: "native" | "js";
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly static?: boolean;
  readonly owner?: MojoAnalyzedClassOwner;
}

export interface MojoAnalyzedFunction extends MojoAnalyzedCallableSignature {
  readonly body: Node;
}

export interface MojoAnalyzedProjectCallable {
  readonly contract: MojoAnalyzedCallableSignature;
  readonly implementation?: MojoAnalyzedFunction;
}

export interface MojoCallableImplementationAdapter {
  readonly kind:
    | "top-level-function-overload"
    | "instance-method-overload"
    | "static-method-overload"
    | "constructor-overload";
  readonly contract: MojoAnalyzedCallableSignature;
  readonly implementation: MojoAnalyzedFunction;
  readonly owner?: MojoAnalyzedClass;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly targetGenericArguments: readonly MojoTargetGenericArgument[];
  readonly targetParameters: readonly MojoAnalyzedParameter[];
  readonly parameterAdapters: readonly MojoCallableParameterAdapter[];
  readonly implementationResultType: MojoTargetTypeRef;
  readonly resultConversion: MojoValueConversion;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
}

export type MojoAnalyzedTopLevelFunction = MojoAnalyzedFunction & {
  readonly kind: "function";
};

export interface MojoAnalyzedClassField {
  readonly kind: "instance-field";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly ownerType: MojoTargetTypeRef;
  readonly ownerTypeParameters: readonly import("../../target-model/types/project.js").MojoProjectTypeParameterDefinition[];
  readonly initializer?: Node;
  readonly visibility: "public" | "private";
}

export interface MojoAnalyzedInterfaceField {
  readonly kind: "interface-field";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly ownerType: MojoTargetTypeRef;
  readonly ownerTypeParameters: readonly import("../../target-model/types/project.js").MojoProjectTypeParameterDefinition[];
  readonly optional: boolean;
  readonly readonly: boolean;
}

export interface MojoAnalyzedInterfaceIndexSignature {
  readonly kind: "interface-index-signature";
  readonly declaration: Node;
  readonly storageName: string;
  readonly keyType: MojoTargetTypeRef;
  readonly valueType: MojoTargetTypeRef;
  readonly ownerType: MojoTargetTypeRef;
  readonly ownerTypeParameters: readonly import("../../target-model/types/project.js").MojoProjectTypeParameterDefinition[];
  readonly readonly: boolean;
}

export interface MojoAnalyzedAccessorProperty {
  readonly kind: "accessor-property";
  readonly declarations: readonly Node[];
  readonly sourceName: string;
  readonly read?: MojoAnalyzedCallableSignature;
  readonly write?: MojoAnalyzedCallableSignature;
  readonly ownerType: MojoTargetTypeRef;
  readonly ownerTypeParameters: readonly import("../../target-model/types/project.js").MojoProjectTypeParameterDefinition[];
}

export interface MojoAnalyzedStaticClassField {
  readonly kind: "static-field";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly binding: MojoAnalyzedModuleBinding;
}

export type MojoAnalyzedProjectField =
  | MojoAnalyzedClassField
  | MojoAnalyzedStaticClassField;

export interface MojoAnalyzedClass {
  readonly kind: "class";
  readonly definition: import("../../target-model/types/project.js").MojoProjectTypeDefinition;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly fields: readonly MojoAnalyzedClassField[];
  readonly methods: readonly MojoAnalyzedFunction[];
  readonly accessors: readonly MojoAnalyzedFunction[];
  readonly callableContracts: readonly MojoAnalyzedCallableSignature[];
  readonly accessorProperties: readonly MojoAnalyzedAccessorProperty[];
  readonly constructors: readonly MojoAnalyzedFunction[];
  readonly heritage: readonly import("../../target-model/types/project.js").MojoProjectHeritageEdge[];
  readonly targetType: MojoTargetTypeRef;
  readonly polymorphic: boolean;
  readonly stateStorage: "direct" | "erased";
  readonly initializationErrorType?: MojoTargetTypeRef;
  readonly errorRole?: "typed";
}

export interface MojoAnalyzedInterface {
  readonly kind: "interface";
  readonly definition: import("../../target-model/types/project.js").MojoProjectTypeDefinition;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly fields: readonly MojoAnalyzedInterfaceField[];
  readonly indexSignatures: readonly MojoAnalyzedInterfaceIndexSignature[];
  readonly methods: readonly MojoAnalyzedCallableSignature[];
  readonly accessors: readonly MojoAnalyzedCallableSignature[];
  readonly accessorProperties: readonly MojoAnalyzedAccessorProperty[];
  readonly heritage: readonly import("../../target-model/types/project.js").MojoProjectHeritageEdge[];
  readonly targetType: MojoTargetTypeRef;
  readonly polymorphic: boolean;
  readonly stateStorage: "direct" | "erased";
}

export type * from "./dispatch-model.js";
export interface MojoAnalyzedEnumMember {
  readonly kind: "enum-member";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly name: string;
  readonly value: number;
  readonly owner: MojoTargetTypeRef;
}

export interface MojoAnalyzedEnum {
  readonly kind: "enum";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly targetType: MojoTargetTypeRef;
  readonly members: readonly MojoAnalyzedEnumMember[];
}

export interface MojoAnalyzedTypeAlias {
  readonly kind: "type-alias";
  readonly id: string;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly value: MojoTargetTypeRef;
  readonly exported: boolean;
}

export type MojoAnalyzedProjectProperty =
  | MojoAnalyzedProjectField
  | MojoAnalyzedInterfaceField
  | MojoAnalyzedInterfaceIndexSignature
  | MojoAnalyzedAccessorProperty
  | MojoAnalyzedEnumMember;

export type MojoAnalyzedDeclaration =
  | MojoAnalyzedTopLevelFunction
  | MojoAnalyzedClass
  | MojoAnalyzedInterface
  | MojoAnalyzedEnum
  | MojoAnalyzedTypeAlias;

export type * from "./module-model.js";
export type * from "./operation-model.js";
export type * from "./program-model.js";
