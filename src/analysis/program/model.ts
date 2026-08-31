import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type { TargetSourceSyntaxProgram } from "@tsonic/target-api/analysis";
import type { MojoProviderOperationRow, MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetConfiguration } from "../../target-model/project/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
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
}

export interface MojoAnalyzedFunction {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly name: string;
  readonly parameters: readonly MojoAnalyzedParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly body: Node;
  readonly raises: boolean;
}

export type MojoCallSelection =
  | {
      readonly kind: "project";
      readonly functionName: string;
      readonly parameterTypes: readonly MojoTargetTypeRef[];
      readonly resultType: MojoTargetTypeRef;
    }
  | {
      readonly kind: "provider";
      readonly operation: MojoProviderOperationRow;
      readonly arguments: readonly Node[];
      readonly receiver?: Node;
    };

export interface MojoProgramQueries {
  bindingName(referenceOrDeclaration: Node): string | undefined;
  bindingType(declaration: Node): MojoTargetTypeRef | undefined;
  expressionType(expression: Node): MojoTargetTypeRef | undefined;
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
  readonly functions: readonly MojoAnalyzedFunction[];
  readonly queries: MojoProgramQueries;
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
}
