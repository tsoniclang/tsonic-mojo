import type { Node, SourceFile } from "@tsonic/tsts";
import {
  rejectedTargetStage,
  resolvedTargetStage,
} from "@tsonic/target-api/artifacts";
import type {
  TargetDiagnostic,
  TargetStageResult,
} from "@tsonic/target-api/artifacts";
import {
  snapshotTargetPlanningSourceNavigation,
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { analyzeMojoTemplateExpression } from "../operations/template-expressions.js";
import { closeMojoErrorType } from "./effects.js";
import { validateMojoFunctionSyntax } from "./syntax-validation.js";
import { createMojoProgramQueries } from "./queries.js";
import { finalizeMojoModuleBindingTypes } from "./module-bindings.js";
import { finalizeMojoModuleEffects } from "./module-effects.js";
import { diagnoseMojoRuntimeModuleCycles } from "./module-cycles.js";
import {
  createMojoRepresentationCatalog,
  mojoRepresentationParameters,
  mojoRepresentationRootTypes,
} from "../representations/index.js";
import { createMojoProjectDispatchPlan } from "../project-types/dispatch.js";
import type { MojoAnalyzedModuleRegionFacts } from "./module-effects.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedDeclaration,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoAnalyzedTypeAlias,
  MojoCallableExpressionSelection,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
  MojoTemplateExpressionSelection,
} from "./model.js";

export interface MojoProgramResultFinalizationInput {
  readonly request: MojoTargetAnalysisRequest;
  readonly sourceFiles: readonly SourceFile[];
  readonly diagnostics: TargetDiagnostic[];
  readonly environment: MojoExecutableRegionAnalysisEnvironment;
  readonly expressionErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly functions: readonly MojoAnalyzedFunction[];
  readonly classes: readonly MojoAnalyzedClass[];
  readonly interfaces: readonly MojoAnalyzedInterface[];
  readonly enums: readonly MojoAnalyzedEnum[];
  readonly typeAliases: readonly MojoAnalyzedTypeAlias[];
  readonly analyzedModules: readonly MojoAnalyzedModule[];
  readonly moduleRegionFacts: WeakMap<MojoAnalyzedModule, MojoAnalyzedModuleRegionFacts>;
  readonly errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>;
  readonly catchErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly callableExpressionNodes: ReadonlySet<Node>;
  readonly objectLiteralNodes: ReadonlySet<Node>;
  readonly callableDeclarationByExpression: WeakMap<Node, Node>;
  readonly templateExpressionSelections: WeakMap<Node, MojoTemplateExpressionSelection>;
  readonly templateExpressionNodes: ReadonlySet<Node>;
  readonly moduleBindingByDeclaration: WeakMap<Node, MojoAnalyzedModuleBinding>;
  readonly reservedNames: ReadonlySet<string>;
}

export function finalizeMojoProgramResult(
  input: MojoProgramResultFinalizationInput,
): TargetStageResult<MojoTargetProgram> {
  const {
    request,
    sourceFiles,
    diagnostics,
    environment,
    expressionErrorTypes,
    functions,
    classes,
    interfaces,
    enums,
    typeAliases,
    analyzedModules,
    moduleRegionFacts,
    errorTypesByDeclaration,
    catchErrorTypes,
    callableExpressionSelections,
    callableExpressionNodes,
    objectLiteralNodes,
    callableDeclarationByExpression,
    templateExpressionSelections,
    templateExpressionNodes,
    moduleBindingByDeclaration,
    reservedNames,
  } = input;
  const { input: hostInput, configuration, providerSemantics } = request;
  const {
    source: checkedSource,
    projectTypes,
    modules,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    conversions,
    callSelections,
    propertySelections,
    valueSelections,
    typeTestSelections,
    nullishCoalescingSelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    objectLiteralSelections,
    bindingPatternSelections,
    returnValueTransfers,
    fieldByDeclaration,
    locationStorageNames,
  } = environment;
  const { ast } = checkedSource;
  const finalizedFunctions = functions.map((function_) => {
    const errorType = closeMojoErrorType(errorTypesByDeclaration.get(function_.declaration) ?? []);
    return Object.freeze({
      ...function_,
      raises: errorType !== undefined,
      ...(errorType === undefined ? {} : { errorType }),
    });
  });
  const finalizedByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  for (const function_ of finalizedFunctions) finalizedByDeclaration.set(function_.declaration, function_);
  const finalizedClasses = classes.map((class_) => {
    const initializationErrorType = class_.constructors.length === 0
      ? closeMojoErrorType(errorTypesByDeclaration.get(class_.declaration) ?? [])
      : undefined;
    const targetTypeId = class_.targetType.kind === "target-named"
      ? class_.targetType.id
      : undefined;
    const typedError = targetTypeId !== undefined &&
      [...errorTypesByDeclaration.values()].some((types) => types.some((type) =>
        type.kind === "target-named" && type.id === targetTypeId));
    return Object.freeze({
      ...class_,
      methods: Object.freeze(class_.methods.map((method) =>
        finalizedByDeclaration.get(method.declaration) ?? method)),
      accessors: Object.freeze(class_.accessors.map((accessor) =>
        finalizedByDeclaration.get(accessor.declaration) ?? accessor)),
      constructors: Object.freeze(class_.constructors.map((constructor) =>
        finalizedByDeclaration.get(constructor.declaration) ?? constructor)),
      ...(initializationErrorType === undefined ? {} : { initializationErrorType }),
      ...(typedError ? { errorRole: "typed" as const } : {}),
    });
  });
  const finalizedModules = finalizeMojoModuleBindingTypes(finalizeMojoModuleEffects(
    analyzedModules,
    modules,
    moduleRegionFacts,
    errorTypesByDeclaration,
  ), bindingTypes);
  diagnostics.push(...diagnoseMojoRuntimeModuleCycles(finalizedModules, modules));
  for (const module of finalizedModules) {
    for (const binding of module.bindings) {
      moduleBindingByDeclaration.set(binding.declaration, binding);
      if (binding.kind !== "class-static-field") continue;
      const field = fieldByDeclaration.get(binding.declaration);
      if (field?.kind === "static-field") {
        fieldByDeclaration.set(binding.declaration, Object.freeze({
          ...field,
          type: binding.type,
          binding,
        }));
      }
    }
  }
  if (configuration.outputType !== "bin") {
    for (const module of finalizedModules) {
      if (!module.asynchronous) continue;
      diagnostics.push(diagnostic(
        "MOJO_LIBRARY_TOP_LEVEL_AWAIT_UNSUPPORTED",
        "Mojo library output cannot publish an asynchronous TypeScript module-initialization contract; select binary output or remove top-level await from the exported module graph.",
        module.sourceFile,
      ));
    }
  }
  const finalizedModuleBySourceFile = new WeakMap(
    finalizedModules.map((module) => [module.sourceFile, module] as const),
  );
  const finalizedModuleById = new Map(
    finalizedModules.map((module) => [module.id, module] as const),
  );

  const typedErrorTypeIds = new Set(finalizedClasses.flatMap((class_) =>
    class_.errorRole === "typed" && class_.targetType.kind === "target-named"
      ? [class_.targetType.id]
      : []));
  for (const expression of templateExpressionNodes) {
    const template = analyzeMojoTemplateExpression(
      expression,
      checkedSource,
      expressionTypes,
      (type) => type.kind === "target-named" && typedErrorTypeIds.has(type.id),
    );
    if (template.kind === "unsupported") {
      diagnostics.push(diagnostic(
        "MOJO_TEMPLATE_STRING_CONVERSION_UNSUPPORTED",
        template.reason,
        template.node,
      ));
    } else {
      templateExpressionSelections.set(expression, template.selection);
    }
  }

  for (const function_ of finalizedFunctions) {
    validateMojoFunctionSyntax(
      function_,
      ast,
      callSelections,
      propertySelections,
      elementSelections,
      iterationSelections,
      valueSelections,
      typeTestSelections,
      objectLiteralSelections,
      callableExpressionSelections,
      bindingPatternSelections,
      resourceManagementSelections,
      bindingNames,
      expressionTypes,
      templateExpressionSelections,
      diagnostics,
    );
  }
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);

  const source = targetSourceSyntaxProgram(checkedSource);
  const sourceNavigation = snapshotTargetPlanningSourceNavigation(checkedSource);
  const queries = createMojoProgramQueries({
    sourceNavigation,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    expressionErrorTypes,
    conversions,
    callSelections,
    propertySelections,
    valueSelections,
    typeTestSelections,
    nullishCoalescingSelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    objectLiteralSelections,
    callableExpressionSelections,
    templateExpressionSelections,
    bindingPatternSelections,
    returnValueTransfers,
    catchErrorTypes,
    moduleBySourceFile: finalizedModuleBySourceFile,
    moduleById: finalizedModuleById,
    moduleBindingByDeclaration,
    locationStorageNames,
  });
  const topLevelFunctions = finalizedFunctions.filter(
    (function_): function_ is import("./model.js").MojoAnalyzedTopLevelFunction =>
      function_.kind === "function",
  );
  const declarations: MojoAnalyzedDeclaration[] = [
    ...topLevelFunctions,
    ...finalizedClasses,
    ...interfaces,
    ...enums,
    ...typeAliases,
  ];
  const projectDispatch = createMojoProjectDispatchPlan({
    classes: finalizedClasses,
    interfaces,
    relationships: environment.projectRelationships,
    callNodes: environment.callNodes,
    callSelections,
    implementations: finalizedByDeclaration,
    objectLiteralNodes,
    objectLiteralSelections,
    callableExpressionSelections,
    libraryOutput: configuration.outputType !== "bin",
  });
  for (const issue of projectDispatch.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);
  const representations = createMojoRepresentationCatalog({
    ast,
    sourceFiles,
    bindingTypes,
    expressionTypes,
    valueRefinements: environment.valueRefinements,
    rootTypes: mojoRepresentationRootTypes(declarations, finalizedModules),
    parameters: mojoRepresentationParameters(declarations),
    modules: finalizedModules,
    sourceModules: modules,
    authoredTypeAliases: typeAliases,
    sourceNavigation,
    callableNavigation: checkedSource.navigation,
    callableExpressionNodes,
    callableExpressionSelections,
    callableDeclarationByExpression,
    lifecycle: environment.lifecycle,
    diagnostics,
    reservedNames,
  });
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);
  const lifecycle = environment.lifecycle.seal(
    representations.carriers().map((carrier) => carrier.type),
  );
  return resolvedTargetStage(Object.freeze({
    host: Object.freeze({
      paths: Object.freeze({ ...hostInput.paths }),
      entryPoint: hostInput.project.entryPoint,
      sourcePackages: hostInput.sourcePackages,
    }),
    configuration,
    source,
    sourceNavigation,
    sourceFiles,
    projectTypes,
    projectRelationships: environment.projectRelationships,
    projectDispatch,
    modules,
    analyzedModules: finalizedModules,
    declarations: Object.freeze(declarations),
    representations,
    lifecycle,
    queries,
    runtimePackages: analyzeMojoRuntimePackages(hostInput.runtimeReferences),
    binaryEpilogues: providerSemantics.binaryEpilogues,
    reservedNames: Object.freeze([...reservedNames].sort((left, right) => left.localeCompare(right, "en"))),
  }));
}
