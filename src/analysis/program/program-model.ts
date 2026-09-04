import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import type {
  TargetPlanningSourceNavigation,
  TargetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type { MojoProviderBinaryEpilogue } from "../../providers/packages/model.js";
import type { MojoTargetConfiguration } from "../../target-model/configuration/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type {
  MojoProjectTypeCatalog,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import type { MojoRepresentationCatalog } from "../representations/model.js";
import type { MojoLifecycleCatalog } from "../lifecycle/model.js";
import type { MojoArrayLiteralSelection } from "../aggregates/model.js";
import type {
  MojoBindingPatternSelection,
  MojoBindingProjectionPlan,
  MojoCallableExpressionSelection,
  MojoObjectLiteralSelection,
  MojoTemplateExpressionSelection,
} from "./binding-and-object-model.js";
import type { MojoCallSelection } from "./call-model.js";
import type {
  MojoAnalyzedDeclaration,
  MojoAnalyzedModule,
  MojoAnalyzedTopLevelFunction,
  MojoCallableImplementationAdapter,
  MojoModuleInitializationCatalog,
  MojoProjectDispatchPlan,
} from "./model.js";
import type { MojoAnalyzedModuleBinding } from "./module-model.js";
import type {
  MojoElementSelection,
  MojoIntrinsicExpressionSelection,
  MojoIterationSelection,
  MojoNullishCoalescingSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTypeTestSelection,
  MojoValueSelection,
} from "./operation-model.js";

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
  intrinsicExpressionSelection(expression: Node): MojoIntrinsicExpressionSelection | undefined;
  typeTestSelection(expression: Node): MojoTypeTestSelection | undefined;
  nullishCoalescingSelection(expression: Node): MojoNullishCoalescingSelection | undefined;
  arrayLiteralSelection(expression: Node): MojoArrayLiteralSelection | undefined;
  elementSelection(access: Node): MojoElementSelection | undefined;
  iterationSelection(statement: Node): MojoIterationSelection | undefined;
  resourceManagementSelection(declaration: Node): MojoResourceManagementSelection | undefined;
  objectLiteralSelection(expression: Node): MojoObjectLiteralSelection | undefined;
  callableExpressionSelection(expression: Node): MojoCallableExpressionSelection | undefined;
  templateExpressionSelection(expression: Node): MojoTemplateExpressionSelection | undefined;
  bindingPatternSelection(declaration: Node): MojoBindingPatternSelection | undefined;
  bindingProjection(declaration: Node): MojoBindingProjectionPlan | undefined;
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
  readonly native?: import("../runtime/native-package.js").MojoRuntimeNativePackagePlan;
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
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly sourceCallableSpecializations: import("../callables/specializations.js").MojoSourceCallableSpecializationPlan;
  readonly projectDispatch: MojoProjectDispatchPlan;
  readonly modules: MojoSourceModuleCatalog;
  readonly analyzedModules: readonly MojoAnalyzedModule[];
  readonly moduleInitialization: MojoModuleInitializationCatalog;
  readonly binaryEntry?: MojoAnalyzedTopLevelFunction;
  readonly declarations: readonly MojoAnalyzedDeclaration[];
  readonly callableImplementationAdapters: readonly MojoCallableImplementationAdapter[];
  readonly representations: MojoRepresentationCatalog;
  readonly lifecycle: MojoLifecycleCatalog;
  readonly queries: MojoProgramQueries;
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
  readonly binaryEpilogues: readonly MojoProviderBinaryEpilogue[];
  readonly reservedNames: readonly string[];
}
