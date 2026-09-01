import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type { TargetSourceSyntaxProgram } from "@tsonic/target-api/analysis";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetConfiguration } from "../../target-model/project/model.js";
import type {
  MojoCallArgumentPosition,
  MojoProviderOperationForm,
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/provider/model.js";
import type { MojoProjectTypeCatalog } from "../types/project-catalog.js";
import type { MojoSourceModuleCatalog } from "../modules/model.js";

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

export type MojoValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "primitive-cast"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "native-to-js-string"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-to-native-string" }
  | { readonly kind: "optional-none"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "optional-some"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "union-inject"; readonly targetType: MojoTargetTypeRef };

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

export interface MojoSelectedProviderOperation {
  readonly target: MojoProviderOperationForm;
  readonly receiverType?: MojoTargetTypeRef;
  readonly parameterTypes: readonly MojoTargetTypeRef[];
  readonly resultType: MojoTargetTypeRef;
  readonly genericArguments: readonly MojoTargetGenericArgument[];
  readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
  readonly raises: boolean;
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
  readonly target: "native-values" | "dictionary-keys";
}

export type MojoCallSelection =
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
    };

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
  elementSelection(access: Node): MojoElementSelection | undefined;
  iterationSelection(statement: Node): MojoIterationSelection | undefined;
  objectLiteralSelection(expression: Node): MojoObjectLiteralSelection | undefined;
  moduleForSourceFile(sourceFile: SourceFile): MojoAnalyzedModule | undefined;
  moduleBinding(referenceOrDeclaration: Node): MojoAnalyzedModuleBinding | undefined;
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

export interface MojoTargetProgram {
  readonly configuration: MojoTargetConfiguration;
  readonly source: TargetSourceSyntaxProgram;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly modules: MojoSourceModuleCatalog;
  readonly analyzedModules: readonly MojoAnalyzedModule[];
  readonly declarations: readonly MojoAnalyzedDeclaration[];
  readonly queries: MojoProgramQueries;
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
  readonly reservedNames: readonly string[];
}
