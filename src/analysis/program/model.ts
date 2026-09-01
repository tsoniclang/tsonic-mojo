import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type {
  TargetPlanningSourceNavigation,
  TargetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetConfiguration } from "../../target-model/configuration/model.js";
import type {
  MojoCallArgumentPosition,
  MojoTargetGenericArgument,
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

export interface MojoTargetAnalysisRequest {
  readonly input: TargetCompileInput;
  readonly configuration: MojoTargetConfiguration;
  readonly providerSemantics: MojoProviderSemantics;
  readonly jsEnabled: boolean;
}

export interface MojoAnalyzedParameter {
  readonly declaration: Node;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly convention: "imm" | "mut" | "var" | "ref" | "out";
  readonly passing: "plain" | "consume";
  readonly optional: boolean;
  readonly rest: boolean;
  readonly initializer?: Node;
}

export interface MojoAnalyzedTypeParameter {
  readonly declaration: Node;
  readonly name: string;
  readonly constraints: readonly MojoTargetTypeRef[];
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
  readonly static?: boolean;
  readonly owner?: MojoAnalyzedClassOwner;
}

export interface MojoAnalyzedClassField {
  readonly kind: "instance-field";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly ownerType: MojoTargetTypeRef;
  readonly ownerTypeParameters: readonly string[];
  readonly initializer: Node;
  readonly visibility: "public" | "private";
}

export interface MojoAnalyzedInterfaceField {
  readonly kind: "interface-field";
  readonly declaration: Node;
  readonly sourceName: string;
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly ownerType: MojoTargetTypeRef;
  readonly ownerTypeParameters: readonly string[];
  readonly optional: boolean;
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
}

export interface MojoAnalyzedInterface {
  readonly kind: "interface";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly stateName: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly fields: readonly MojoAnalyzedInterfaceField[];
  readonly targetType: MojoTargetTypeRef;
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

export type MojoAnalyzedProjectProperty =
  | MojoAnalyzedProjectField
  | MojoAnalyzedInterfaceField
  | MojoAnalyzedEnumMember;

export type MojoAnalyzedDeclaration =
  | MojoAnalyzedFunction
  | MojoAnalyzedClass
  | MojoAnalyzedInterface
  | MojoAnalyzedEnum;

export interface MojoAnalyzedModuleBinding {
  readonly kind: "module-binding" | "class-static-field";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly name: string;
  readonly declarationKind: "const" | "let" | "var";
  readonly storage: "comptime" | "cell";
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
  readonly runtimeInitializationRequired: boolean;
}

export interface MojoAnalyzedCallArgument {
  readonly expression: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly parameterType: MojoTargetTypeRef;
  readonly conversion: MojoValueConversion;
  readonly passing: "plain" | "consume";
  readonly spread: boolean;
  readonly position: MojoCallArgumentPosition;
  readonly nativeName?: string;
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
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "provider-constant";
      readonly operation: MojoSelectedProviderOperation;
      readonly readResultConversion: MojoValueConversion;
    };

export interface MojoValueSelection {
  readonly kind: "provider-constant";
  readonly operation: MojoSelectedProviderOperation;
  readonly resultConversion: MojoValueConversion;
}

export type MojoValueRefinementSelection =
  | {
      readonly kind: "optional-present";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "optional" }>;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "union-member";
      readonly sourceType: Extract<MojoTargetTypeRef, { readonly kind: "union" }>;
      readonly resultType: MojoTargetTypeRef;
    };

export type MojoTypeTestSelection =
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

export type MojoCallSelection =
  | {
      readonly kind: "raw-pointer";
      readonly operation: "bind";
      readonly identityExpression: Node;
      readonly identityType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "raw-pointer";
      readonly operation: "equal";
      readonly leftExpression: Node;
      readonly leftType: MojoTargetTypeRef;
      readonly rightExpression: Node;
      readonly rightType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "raw-pointer";
      readonly operation: "hash";
      readonly pointerExpression: Node;
      readonly pointerType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "address-of";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly storageDeclaration: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "allocate";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly initialExpression: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "load";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly pointerExpression: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "store";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly pointerExpression: Node;
      readonly valueExpression: Node;
    }
  | {
      readonly kind: "typed-location";
      readonly operation: "equal-pointer";
      readonly pointeeType: MojoTargetTypeRef;
      readonly locationType: MojoTargetTypeRef;
      readonly resultType: MojoTargetTypeRef;
      readonly leftExpression: Node;
      readonly rightExpression: Node;
    }
  | {
      readonly kind: "project";
      readonly target:
        | {
            readonly kind: "function";
            readonly name: string;
            readonly modulePath: readonly string[];
          }
        | {
            readonly kind: "method";
            readonly name: string;
            readonly receiver: Node;
            readonly receiverType: MojoTargetTypeRef;
          }
        | { readonly kind: "static-method"; readonly owner: MojoTargetTypeRef; readonly name: string }
        | { readonly kind: "constructor"; readonly type: MojoTargetTypeRef };
      readonly genericArguments: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "provider";
      readonly operation: MojoSelectedProviderOperation;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly receiver?: Node;
      readonly sourceReceiverType?: MojoTargetTypeRef;
      readonly receiverConversion?: MojoValueConversion;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: boolean;
    }
  | {
      readonly kind: "callable";
      readonly callee: Node;
      readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
      readonly optionalChain: boolean;
    };

export interface MojoCallableCapture {
  readonly declaration: Node;
  readonly name: string;
  readonly convention: "imm" | "mut";
}

export interface MojoCallableExpressionSelection {
  readonly expression: Node;
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly captures: readonly MojoCallableCapture[];
  readonly resultType: MojoTargetTypeRef;
  readonly body: Node;
  readonly raises: boolean;
  readonly callableType: Extract<MojoTargetTypeRef, { readonly kind: "function" }>;
}

export type MojoBindingProjection =
  | { readonly kind: "element"; readonly index: number }
  | { readonly kind: "project-field"; readonly name: string }
  | { readonly kind: "dictionary-key"; readonly key: string };

export interface MojoBindingPatternElementSelection {
  readonly element: Node;
  readonly projection: MojoBindingProjection;
  readonly projectedType: MojoTargetTypeRef;
  readonly target:
    | {
        readonly kind: "binding";
        readonly declaration: Node;
        readonly name: string;
        readonly type: MojoTargetTypeRef;
      }
    | {
        readonly kind: "pattern";
        readonly pattern: Node;
        readonly elements: readonly MojoBindingPatternElementSelection[];
      };
}

export interface MojoBindingPatternSelection {
  readonly declaration: Node;
  readonly initializer: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly elements: readonly MojoBindingPatternElementSelection[];
}

export type MojoObjectLiteralContribution =
  | {
      readonly kind: "field";
      readonly element: Node;
      readonly value: Node;
      readonly field: MojoAnalyzedInterfaceField;
      readonly fieldType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "spread";
      readonly element: Node;
      readonly value: Node;
      readonly sourceType: MojoTargetTypeRef;
      readonly fields: readonly {
        readonly field: MojoAnalyzedInterfaceField;
        readonly fieldType: MojoTargetTypeRef;
      }[];
    };

export interface MojoObjectLiteralSelection {
  readonly kind: "interface";
  readonly interface: MojoAnalyzedInterface;
  readonly targetType: MojoTargetTypeRef;
  readonly fields: readonly {
    readonly field: MojoAnalyzedInterfaceField;
    readonly fieldType: MojoTargetTypeRef;
  }[];
  readonly contributions: readonly MojoObjectLiteralContribution[];
}

export interface MojoProgramQueries {
  bindingName(referenceOrDeclaration: Node): string | undefined;
  bindingSourceFile(referenceOrDeclaration: Node): SourceFile | undefined;
  bindingType(declaration: Node): MojoTargetTypeRef | undefined;
  expressionType(expression: Node): MojoTargetTypeRef | undefined;
  expressionConversion(
    expression: Node,
    expectedType: MojoTargetTypeRef,
  ): MojoValueConversion | undefined;
  callSelection(call: Node): MojoCallSelection | undefined;
  propertySelection(access: Node): MojoPropertySelection | undefined;
  valueSelection(expression: Node): MojoValueSelection | undefined;
  valueRefinement(expression: Node): MojoValueRefinementSelection | undefined;
  typeTestSelection(expression: Node): MojoTypeTestSelection | undefined;
  elementSelection(access: Node): MojoElementSelection | undefined;
  iterationSelection(statement: Node): MojoIterationSelection | undefined;
  objectLiteralSelection(expression: Node): MojoObjectLiteralSelection | undefined;
  callableExpressionSelection(expression: Node): MojoCallableExpressionSelection | undefined;
  bindingPatternSelection(declaration: Node): MojoBindingPatternSelection | undefined;
  moduleForSourceFile(sourceFile: SourceFile): MojoAnalyzedModule | undefined;
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
  readonly queries: MojoProgramQueries;
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
  readonly reservedNames: readonly string[];
}
