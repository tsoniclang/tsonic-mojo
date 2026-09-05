import type { Node } from "@tsonic/tsts";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoParameterDisposition } from "../representations/model.js";
import type {
  MojoAnalyzedAccessorProperty,
  MojoAnalyzedClass,
  MojoAnalyzedClassField,
  MojoAnalyzedFunction,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedInterfaceIndexSignature,
  MojoAnalyzedParameter,
  MojoAnalyzedCallableSignature,
} from "./model.js";
import type {
  MojoCallableCapture,
  MojoCallableExpressionSelection,
  MojoObjectLiteralContribution,
  MojoObjectLiteralSelection,
} from "./binding-and-object-model.js";

export interface MojoProjectDispatchCallableVariant {
  readonly contract: MojoAnalyzedCallableSignature;
  readonly genericArguments: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[];
  readonly name: string;
  readonly slotName: string;
  readonly slotType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly property?: MojoProjectDispatchMethodProperty;
}

export interface MojoProjectDispatchMethodProperty {
  readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
  readonly read?: MojoProjectDispatchMethodPropertyAccess;
  readonly write?: MojoProjectDispatchMethodPropertyAccess;
}

export interface MojoProjectDispatchMethodPropertyAccess {
  readonly name: string;
  readonly slotName: string;
  readonly slotType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
}

export interface MojoProjectMethodStorage {
  readonly declarations: readonly Node[];
  readonly name: string;
  readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
  readonly storageType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
}

export interface MojoProjectDispatchFieldAccess {
  readonly name: string;
  readonly slotName: string;
  readonly slotType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
  readonly valueType: MojoTargetTypeRef;
  readonly disposition?: MojoParameterDisposition;
}

export interface MojoProjectDispatchField {
  readonly property: MojoAnalyzedClassField | MojoAnalyzedInterfaceField | MojoAnalyzedAccessorProperty;
  readonly read?: MojoProjectDispatchFieldAccess;
  readonly write?: MojoProjectDispatchFieldAccess;
}

export interface MojoProjectDispatchIndexAccess {
  readonly name: string;
  readonly slotName: string;
  readonly slotType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
}

export interface MojoProjectDispatchIndex {
  readonly indexSignature: MojoAnalyzedInterfaceIndexSignature;
  readonly keyType: MojoTargetTypeRef;
  readonly valueType: MojoTargetTypeRef;
  readonly read: MojoProjectDispatchIndexAccess;
  readonly write?: MojoProjectDispatchIndexAccess;
  readonly copy: MojoProjectDispatchIndexAccess;
}

export interface MojoProjectDispatchIndexAdapter {
  readonly index: MojoProjectDispatchIndex;
  readonly storageName: string;
  readonly storageType: Extract<MojoTargetTypeRef, { readonly kind: "dictionary" }>;
  readonly readAdapterName: string;
  readonly writeAdapterName?: string;
  readonly copyAdapterName: string;
}

export interface MojoProjectDowncastRoute {
  readonly source: import("../../target-model/types/project.js").MojoProjectTypeDefinition;
  readonly target: import("../../target-model/types/project.js").MojoProjectTypeDefinition;
  readonly targetType: MojoTargetTypeRef;
  readonly name: string;
  readonly slotName: string;
  readonly slotType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
}

export interface MojoProjectDowncastAdapter {
  readonly route: MojoProjectDowncastRoute;
  readonly adapterName: string;
  readonly available: boolean;
}

export interface MojoProjectDispatchView {
  readonly definition: import("../../target-model/types/project.js").MojoProjectTypeDefinition;
  readonly type: MojoTargetTypeRef;
  readonly callables: readonly MojoProjectDispatchCallableVariant[];
  readonly fields: readonly MojoProjectDispatchField[];
  readonly indexes: readonly MojoProjectDispatchIndex[];
  readonly downcasts: readonly MojoProjectDowncastRoute[];
  readonly conversions: readonly {
    readonly target: import("../../target-model/types/project.js").MojoProjectTypeDefinition;
    readonly targetType: MojoTargetTypeRef;
    readonly name: string;
    readonly slotName: string;
    readonly slotType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
  }[];
}

export type MojoCallableParameterAdapter =
  | {
      readonly kind: "value";
      readonly sourceIndex: number;
      readonly source: MojoAnalyzedParameter;
      readonly target: MojoAnalyzedParameter;
      readonly conversion: MojoValueConversion;
    }
  | {
      readonly kind: "omitted";
      readonly target: MojoAnalyzedParameter;
    }
  | {
      readonly kind: "fixed-rest";
      readonly sourceIndexes: readonly number[];
      readonly sources: readonly MojoAnalyzedParameter[];
      readonly target: MojoAnalyzedParameter;
      readonly conversions: readonly MojoValueConversion[];
    }
  | {
      readonly kind: "sequence-rest";
      readonly sourceIndex: number;
      readonly source: MojoAnalyzedParameter;
      readonly target: MojoAnalyzedParameter;
      readonly elementConversion: MojoValueConversion;
    };

export interface MojoProjectDispatchCallableAdapter {
  readonly variant: MojoProjectDispatchCallableVariant;
  readonly genericArguments: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly adapterName: string;
  readonly implementationName: string;
  readonly implementation: MojoAnalyzedFunction;
  readonly implementationOwnerType: MojoTargetTypeRef;
  readonly parameterAdapters: readonly MojoCallableParameterAdapter[];
  readonly resultConversion: MojoValueConversion;
  readonly methodStorage?: MojoProjectMethodStorage;
  readonly methodCallAdapterName?: string;
  readonly methodBindAdapterName?: string;
  readonly methodReadAdapterName?: string;
  readonly methodWriteAdapterName?: string;
}

export type MojoProjectDispatchFieldAdapter =
  | {
      readonly kind: "stored";
      readonly field: MojoProjectDispatchField;
      readonly readAdapterName?: string;
      readonly writeAdapterName?: string;
      readonly statePath: readonly string[];
      readonly storageType: MojoTargetTypeRef;
      readonly readType?: MojoTargetTypeRef;
      readonly writeType?: MojoTargetTypeRef;
      readonly readResultConversion?: MojoValueConversion;
      readonly writeValueConversion?: MojoValueConversion;
    }
  | {
      readonly kind: "accessor";
      readonly field: MojoProjectDispatchField;
      readonly readAdapterName?: string;
      readonly writeAdapterName?: string;
      readonly readImplementation?: MojoAnalyzedFunction;
      readonly writeImplementation?: MojoAnalyzedFunction;
      readonly implementationOwnerType: MojoTargetTypeRef;
      readonly readType?: MojoTargetTypeRef;
      readonly writeType?: MojoTargetTypeRef;
      readonly readResultConversion?: MojoValueConversion;
      readonly writeValueConversion?: MojoValueConversion;
      readonly writeImplementationParameter?: MojoAnalyzedParameter;
    };

export interface MojoProjectConcreteViewDispatch {
  readonly view: MojoProjectDispatchView;
  readonly viewType: MojoTargetTypeRef;
  readonly conversionAdapterName: string;
  readonly callableAdapters: readonly MojoProjectDispatchCallableAdapter[];
  readonly fieldAdapters: readonly MojoProjectDispatchFieldAdapter[];
  readonly indexAdapters: readonly MojoProjectDispatchIndexAdapter[];
  readonly downcastAdapters: readonly MojoProjectDowncastAdapter[];
}

export interface MojoProjectConcreteDispatch {
  readonly concrete: MojoAnalyzedClass;
  readonly views: readonly MojoProjectConcreteViewDispatch[];
  readonly methodStorages: readonly MojoProjectMethodStorage[];
  readonly indexStorages: readonly {
    readonly name: string;
    readonly type: Extract<MojoTargetTypeRef, { readonly kind: "dictionary" }>;
  }[];
}

export interface MojoProjectObjectLiteralCallableAdapter {
  readonly variant: MojoProjectDispatchCallableVariant;
  readonly implementation?: MojoCallableExpressionSelection;
  readonly genericArguments: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly parameterAdapters: readonly MojoCallableParameterAdapter[];
  readonly resultConversion: MojoValueConversion;
  readonly adapterName: string;
  readonly methodStorage?: MojoProjectObjectLiteralMethodStorage;
  readonly methodCallAdapterName?: string;
  readonly methodBindAdapterName?: string;
  readonly methodReadAdapterName?: string;
  readonly methodWriteAdapterName?: string;
}

export interface MojoProjectObjectLiteralMethodStorage extends MojoProjectMethodStorage {
  readonly initialization:
    | { readonly kind: "default" }
    | {
        readonly kind: "spread";
        readonly contribution: Extract<MojoObjectLiteralContribution, { readonly kind: "spread" }>;
        readonly declaration: Node;
      };
}

export type MojoProjectObjectLiteralFieldAdapter =
  | {
      readonly kind: "stored";
      readonly field: MojoProjectDispatchField;
      readonly stateName: string;
      readonly storageType: MojoTargetTypeRef;
      readonly readType?: MojoTargetTypeRef;
      readonly writeType?: MojoTargetTypeRef;
      readonly readResultConversion?: MojoValueConversion;
      readonly writeValueConversion?: MojoValueConversion;
      readonly readAdapterName?: string;
      readonly writeAdapterName?: string;
    }
  | {
      readonly kind: "accessor";
      readonly field: MojoProjectDispatchField;
      readonly readImplementation?: MojoCallableExpressionSelection;
      readonly writeImplementation?: MojoCallableExpressionSelection;
      readonly readType?: MojoTargetTypeRef;
      readonly writeType?: MojoTargetTypeRef;
      readonly readResultConversion?: MojoValueConversion;
      readonly writeValueConversion?: MojoValueConversion;
      readonly readAdapterName?: string;
      readonly writeAdapterName?: string;
    };

export interface MojoProjectObjectLiteralViewDispatch {
  readonly view: MojoProjectDispatchView;
  readonly viewType: MojoTargetTypeRef;
  readonly factoryName: string;
  readonly callableAdapters: readonly MojoProjectObjectLiteralCallableAdapter[];
  readonly fieldAdapters: readonly MojoProjectObjectLiteralFieldAdapter[];
  readonly indexAdapters: readonly MojoProjectDispatchIndexAdapter[];
  readonly downcastAdapters: readonly MojoProjectDowncastAdapter[];
}

export interface MojoProjectObjectLiteralDispatch {
  readonly expression: Node;
  readonly selection: Extract<MojoObjectLiteralSelection, { readonly kind: "interface" }>;
  readonly captures: readonly {
    readonly capture: MojoCallableCapture;
    readonly stateName: string;
    readonly storageType: MojoTargetTypeRef;
  }[];
  readonly views: readonly MojoProjectObjectLiteralViewDispatch[];
  readonly methodStorages: readonly MojoProjectObjectLiteralMethodStorage[];
}

export interface MojoProjectDispatchPlan {
  readonly issues: readonly {
    readonly node: Node;
    readonly code: string;
    readonly message: string;
  }[];
  readonly representationTypes: readonly MojoTargetTypeRef[];
  viewForType(type: MojoTargetTypeRef): MojoProjectDispatchView | undefined;
  callableFor(
    receiverType: MojoTargetTypeRef,
    declaration: Node,
    genericArguments: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[],
  ): MojoProjectDispatchCallableVariant | undefined;
  fieldFor(
    receiverType: MojoTargetTypeRef,
    declaration: Node,
  ): MojoProjectDispatchField | undefined;
  indexFor(
    receiverType: MojoTargetTypeRef,
    declaration: Node,
  ): MojoProjectDispatchIndex | undefined;
  downcastFor(
    sourceType: MojoTargetTypeRef,
    targetType: MojoTargetTypeRef,
  ): MojoProjectDowncastRoute | undefined;
  conversionFor(
    sourceType: MojoTargetTypeRef,
    targetType: MojoTargetTypeRef,
  ): MojoProjectDispatchView["conversions"][number] | undefined;
  concreteFor(
    definition: import("../../target-model/types/project.js").MojoProjectTypeDefinition,
  ): MojoProjectConcreteDispatch | undefined;
  objectLiteralFor(expression: Node): MojoProjectObjectLiteralDispatch | undefined;
  statePath(
    definition: import("../../target-model/types/project.js").MojoProjectTypeDefinition,
    declaration: Node,
  ): readonly string[] | undefined;
  implementationName(
    declaration: Node,
    genericArguments?: readonly import("../../target-model/types/model.js").MojoTargetGenericArgument[],
  ): string | undefined;
}


