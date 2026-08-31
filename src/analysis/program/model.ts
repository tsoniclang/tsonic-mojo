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

export interface MojoAnalyzedFunction {
  readonly kind: "function";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly body: Node;
  readonly asynchronous: boolean;
  readonly raises: boolean;
}

export type MojoAnalyzedDeclaration = MojoAnalyzedFunction;

export type MojoValueConversion =
  | { readonly kind: "identity" }
  | { readonly kind: "primitive-cast"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "native-to-js-string"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "js-to-native-string" };

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

export type MojoCallSelection =
  | {
      readonly kind: "project";
      readonly functionName: string;
      readonly genericArguments: readonly MojoTargetGenericArgument[];
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly resultType: MojoTargetTypeRef;
      readonly resultConversion: MojoValueConversion;
    }
  | {
      readonly kind: "provider";
      readonly operation: MojoSelectedProviderOperation;
      readonly arguments: readonly MojoAnalyzedCallArgument[];
      readonly receiver?: Node;
      readonly receiverConversion?: MojoValueConversion;
      readonly resultConversion: MojoValueConversion;
    };

export interface MojoProgramQueries {
  bindingName(referenceOrDeclaration: Node): string | undefined;
  bindingType(declaration: Node): MojoTargetTypeRef | undefined;
  expressionType(expression: Node): MojoTargetTypeRef | undefined;
  expressionConversion(
    expression: Node,
    expectedType: MojoTargetTypeRef,
  ): MojoValueConversion | undefined;
  callSelection(call: Node): MojoCallSelection | undefined;
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
  readonly declarations: readonly MojoAnalyzedDeclaration[];
  readonly queries: MojoProgramQueries;
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
}
