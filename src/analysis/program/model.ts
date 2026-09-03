import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type {
  TargetPlanningSourceNavigation,
  TargetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type {
  MojoProviderBinaryEpilogue,
  MojoProviderSemantics,
} from "../../providers/packages/model.js";
import type { MojoTargetConfiguration } from "../../target-model/configuration/model.js";
import type {
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type {
  MojoSelectedProviderOperation,
} from "../../target-model/operations/selection.js";
import type {
  MojoValueConversion,
} from "../../target-model/conversions/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type { MojoValueRefinementSelection } from "../refinements/model.js";
export type { MojoValueRefinementSelection } from "../refinements/model.js";
import type { MojoRepresentationCatalog } from "../representations/model.js";
import type { MojoLifecycleCatalog } from "../lifecycle/model.js";
import type { MojoParameterDisposition } from "../representations/model.js";
import type { MojoBindingDisposition } from "../representations/model.js";
import type { MojoCallSelection } from "./call-model.js";
import type {
  MojoCallableExpressionSelection,
  MojoTemplateExpressionSelection,
  MojoBindingPatternSelection,
  MojoObjectLiteralSelection,
} from "./binding-and-object-model.js";
export type {
  MojoCallableCapture,
  MojoRecursiveCallableBinding,
  MojoCallableExpressionSelection,
  MojoTemplateStringConversion,
  MojoTemplateExpressionSelection,
  MojoBindingValueProjection,
  MojoBindingProjection,
  MojoBindingNormalization,
  MojoBindingPatternElementSelection,
  MojoBindingPatternSelection,
  MojoObjectLiteralContribution,
  MojoObjectLiteralSelection,
} from "./binding-and-object-model.js";
export type { MojoAnalyzedCallArgument, MojoCallSelection } from "./call-model.js";

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

export interface MojoAnalyzedFunction {
  readonly kind: "function" | "method" | "constructor" | "getter" | "setter";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly body: Node;
  readonly asynchronous: boolean;
  readonly asyncDomain?: "native" | "js";
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly static?: boolean;
  readonly owner?: MojoAnalyzedClassOwner;
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
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly fields: readonly MojoAnalyzedClassField[];
  readonly methods: readonly MojoAnalyzedFunction[];
  readonly constructors: readonly MojoAnalyzedFunction[];
  readonly targetType: MojoTargetTypeRef;
  readonly stateStorage: "direct" | "erased";
  readonly initializationErrorType?: MojoTargetTypeRef;
  readonly errorRole?: "typed";
}

export interface MojoAnalyzedInterface {
  readonly kind: "interface";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly fields: readonly MojoAnalyzedInterfaceField[];
  readonly indexSignatures: readonly MojoAnalyzedInterfaceIndexSignature[];
  readonly targetType: MojoTargetTypeRef;
  readonly stateStorage: "direct" | "erased";
}

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
  | MojoAnalyzedEnumMember;

export type MojoAnalyzedDeclaration =
  | MojoAnalyzedTopLevelFunction
  | MojoAnalyzedClass
  | MojoAnalyzedInterface
  | MojoAnalyzedEnum
  | MojoAnalyzedTypeAlias;

export interface MojoAnalyzedModuleBinding {
  readonly kind: "module-binding" | "class-static-field";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly name: string;
  readonly declarationKind: "const" | "let" | "var" | "using" | "await using";
  readonly disposition: MojoBindingDisposition;
  readonly type: MojoTargetTypeRef;
  readonly initializer: Node;
}

export type MojoModuleInitializationStep =
  | {
      readonly kind: "binding";
      readonly binding: MojoAnalyzedModuleBinding;
    }
  | {
      readonly kind: "statement";
      readonly statement: Node;
    }
  | {
      readonly kind: "class-static-block";
      readonly declaration: Node;
      readonly body: Node;
      readonly statements: readonly Node[];
    };

export interface MojoAnalyzedModule {
  readonly id: string;
  readonly sourceFile: SourceFile;
  readonly stateName: string;
  readonly createStateName: string;
  readonly cellName: string;
  readonly initializeName: string;
  readonly lifecycleLockName: string;
  readonly lifecycleInitializedName: string;
  readonly bindings: readonly MojoAnalyzedModuleBinding[];
  readonly initializationSteps: readonly MojoModuleInitializationStep[];
  readonly asynchronous: boolean;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly initializationStateRequired: boolean;
  readonly runtimeInitializationRequired: boolean;
}

export type MojoPropertySelection =
  | {
      readonly kind: "project-field";
      readonly receiver: Node;
      readonly fieldName: string;
      readonly fieldType: MojoTargetTypeRef;
      readonly receiverType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-index-property";
      readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef;
      readonly storageName: string;
      readonly key: string;
      readonly keyType: MojoTargetTypeRef;
      readonly fieldType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "structural-field";
      readonly receiver: Node;
      readonly receiverType: MojoTargetTypeRef;
      readonly storageIndex: number;
      readonly fieldType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-union-field";
      readonly receiver: Node;
      readonly receiverType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly fields: readonly {
        readonly receiverType: MojoTargetTypeRef;
        readonly fieldName: string;
        readonly fieldType: MojoTargetTypeRef;
      }[];
      readonly resultType: MojoTargetTypeRef;
      readonly accessMode: "read";
    }
  | {
      readonly kind: "project-static-field";
      readonly binding: MojoAnalyzedModuleBinding;
      readonly fieldName: string;
      readonly fieldType: MojoTargetTypeRef;
      readonly accessMode: "read" | "write" | "read-write";
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "project-enum-member";
      readonly owner: MojoTargetTypeRef;
      readonly name: string;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "provider";
      readonly readOperation?: MojoSelectedProviderOperation;
      readonly writeOperation?: MojoSelectedProviderOperation;
      readonly receiver: Node;
      readonly sourceReceiverType: MojoTargetTypeRef;
      readonly receiverConversion?: MojoValueConversion;
      readonly readResultConversion?: MojoValueConversion;
      readonly sourceWriteType?: MojoTargetTypeRef;
      readonly targetWriteType?: MojoTargetTypeRef;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "provider-constant";
      readonly operation: MojoSelectedProviderOperation;
      readonly readResultConversion: MojoValueConversion;
    }
  | {
      readonly kind: "provider-static";
      readonly readOperation?: MojoSelectedProviderOperation;
      readonly writeOperation?: MojoSelectedProviderOperation;
      readonly readResultConversion?: MojoValueConversion;
      readonly sourceWriteType?: MojoTargetTypeRef;
      readonly targetWriteType?: MojoTargetTypeRef;
    };

export interface MojoValueSelection {
  readonly kind: "provider-constant";
  readonly operation: MojoSelectedProviderOperation;
  readonly resultConversion: MojoValueConversion;
}

export type MojoTypeTestSelection =
  | {
      readonly kind: "nullish-comparison";
      readonly left: Node;
      readonly right: Node;
      readonly outcome:
        | { readonly kind: "constant"; readonly value: boolean }
        | {
            readonly kind: "optional-absence";
            readonly operand: "left" | "right";
            readonly equal: boolean;
          }
        | {
            readonly kind: "union-membership";
            readonly operand: "left" | "right";
            readonly testedTypes: readonly Extract<MojoTargetTypeRef, {
              readonly kind: "null" | "undefined";
            }>[];
            readonly equal: boolean;
          };
    }
  | {
      readonly kind: "constant";
      readonly value: boolean;
      readonly operand: Node;
    }
  | {
      readonly kind: "optional-presence";
      readonly operand: Node;
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
    }
  | {
      readonly kind: "union-member";
      readonly operand: Node;
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly testedType: MojoTargetTypeRef;
    };

export type MojoNullishCoalescingSelection =
  | {
      readonly kind: "left";
      readonly left: Node;
      readonly resultType: MojoTargetTypeRef;
      readonly conversion: MojoValueConversion;
    }
  | {
      readonly kind: "right";
      readonly left: Node;
      readonly right: Node;
      readonly resultType: MojoTargetTypeRef;
      readonly conversion: MojoValueConversion;
    }
  | {
      readonly kind: "optional" | "union";
      readonly left: Node;
      readonly right: Node;
      readonly leftType: MojoTargetTypeRef;
      readonly presentType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly presentConversion: MojoValueConversion;
      readonly rightConversion: MojoValueConversion;
      readonly presentRefinement?: MojoValueRefinementSelection;
    };

export type MojoElementSelection = {
  readonly kind: "native";
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "read" | "write" | "read-write";
  readonly receiverType: MojoTargetTypeRef;
  readonly indexType: MojoTargetTypeRef;
  readonly readType?: MojoTargetTypeRef;
  readonly writeType?: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly readResultConversion?: MojoValueConversion;
  readonly selectedElementIndex?: number;
  readonly evaluateSelectedIndex?: boolean;
  readonly sourceIndexType?: MojoTargetTypeRef;
  readonly optionalChain: boolean;
} | {
  readonly kind: "project-index";
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "read" | "write" | "read-write";
  readonly receiverType: MojoTargetTypeRef;
  readonly storageName: string;
  readonly indexType: MojoTargetTypeRef;
  readonly readType?: MojoTargetTypeRef;
  readonly writeType?: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly readResultConversion?: MojoValueConversion;
  readonly optionalChain: boolean;
} | {
  readonly kind: "provider";
  readonly receiver: Node;
  readonly index: Node;
  readonly accessMode: "read" | "write" | "read-write";
  readonly readOperation?: MojoSelectedProviderOperation;
  readonly writeOperation?: MojoSelectedProviderOperation;
  readonly receiverConversion: MojoValueConversion;
  readonly sourceReceiverType: MojoTargetTypeRef;
  readonly indexConversion: MojoValueConversion;
  readonly readType?: MojoTargetTypeRef;
  readonly writeType?: MojoTargetTypeRef;
  readonly sourceWriteType?: MojoTargetTypeRef;
  readonly targetWriteType?: MojoTargetTypeRef;
  readonly readResultConversion?: MojoValueConversion;
  readonly optionalChain: boolean;
};

export interface MojoIterationSelection {
  readonly kind: "for-of" | "for-in";
  readonly statement: Node;
  readonly iterable: Node;
  readonly bindingDeclaration: Node;
  readonly bindingName: string;
  readonly iterableType: MojoTargetTypeRef;
  readonly elementType: MojoTargetTypeRef;
  readonly target:
    | "native-values"
    | "dictionary-keys"
    | "js-array-values"
    | "js-map-entries"
    | "js-set-values"
    | "js-string-values";
}

export type MojoResourceDisposalSelection =
  | {
      readonly kind: "project";
      readonly name: string;
      readonly asynchronous: boolean;
      readonly raises: boolean;
      readonly dependency: Node;
    }
  | {
      readonly kind: "provider";
      readonly identity: string;
      readonly operation: MojoSelectedProviderOperation;
      readonly asynchronous: boolean;
    };

export interface MojoResourceDisposalAlternative {
  readonly resourceType: MojoTargetTypeRef;
  readonly disposal: MojoResourceDisposalSelection;
}

export interface MojoResourceManagementSelection {
  readonly declaration: Node;
  readonly declarationKind: "using" | "await using";
  readonly bindingName: string;
  readonly storageType: MojoTargetTypeRef;
  readonly resourceType: MojoTargetTypeRef;
  readonly storageMode: "direct" | "optional" | "nullish-union";
  readonly alternatives: readonly MojoResourceDisposalAlternative[];
}

export interface MojoProgramQueries {
  bindingName(referenceOrDeclaration: Node): string | undefined;
  bindingSourceFile(referenceOrDeclaration: Node): SourceFile | undefined;
  bindingType(declaration: Node): MojoTargetTypeRef | undefined;
  expressionType(expression: Node): MojoTargetTypeRef | undefined;
  expressionErrorType(expression: Node): MojoTargetTypeRef | undefined;
  expressionConversion(
    expression: Node,
    expectedType: MojoTargetTypeRef,
  ): MojoValueConversion | undefined;
  callSelection(call: Node): MojoCallSelection | undefined;
  propertySelection(access: Node): MojoPropertySelection | undefined;
  valueSelection(expression: Node): MojoValueSelection | undefined;
  typeTestSelection(expression: Node): MojoTypeTestSelection | undefined;
  nullishCoalescingSelection(expression: Node): MojoNullishCoalescingSelection | undefined;
  elementSelection(access: Node): MojoElementSelection | undefined;
  iterationSelection(statement: Node): MojoIterationSelection | undefined;
  resourceManagementSelection(declaration: Node): MojoResourceManagementSelection | undefined;
  objectLiteralSelection(expression: Node): MojoObjectLiteralSelection | undefined;
  callableExpressionSelection(expression: Node): MojoCallableExpressionSelection | undefined;
  templateExpressionSelection(expression: Node): MojoTemplateExpressionSelection | undefined;
  bindingPatternSelection(declaration: Node): MojoBindingPatternSelection | undefined;
  returnValueTransfer(expression: Node): boolean;
  catchErrorType(catchClause: Node): MojoTargetTypeRef | undefined;
  moduleForSourceFile(sourceFile: SourceFile): MojoAnalyzedModule | undefined;
  moduleForId(id: string): MojoAnalyzedModule | undefined;
  moduleBinding(referenceOrDeclaration: Node): MojoAnalyzedModuleBinding | undefined;
  locationStorage(referenceOrDeclaration: Node): {
    readonly declaration: Node;
    readonly name: string;
    readonly valueType: MojoTargetTypeRef;
  } | undefined;
}

export interface MojoRuntimePackagePlan {
  readonly packageName: string;
  readonly digest: string;
  readonly sources: readonly {
    readonly path: string;
    readonly digest: string;
    readonly text: string;
  }[];
}

export interface MojoPlanningHost {
  readonly paths: TargetCompileInput["paths"];
  readonly entryPoint: string;
  readonly sourcePackages: TargetCompileInput["sourcePackages"];
}

export interface MojoTargetProgram {
  readonly host: MojoPlanningHost;
  readonly configuration: MojoTargetConfiguration;
  readonly source: TargetSourceSyntaxProgram;
  readonly sourceNavigation: TargetPlanningSourceNavigation;
  readonly sourceFiles: readonly SourceFile[];
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly modules: MojoSourceModuleCatalog;
  readonly analyzedModules: readonly MojoAnalyzedModule[];
  readonly declarations: readonly MojoAnalyzedDeclaration[];
  readonly representations: MojoRepresentationCatalog;
  readonly lifecycle: MojoLifecycleCatalog;
  readonly queries: MojoProgramQueries;
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
  readonly binaryEpilogues: readonly MojoProviderBinaryEpilogue[];
  readonly reservedNames: readonly string[];
}
