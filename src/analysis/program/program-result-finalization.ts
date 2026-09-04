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
import { validateMojoExecutableRegionSyntax } from "./syntax-validation.js";
import { createMojoProgramQueries } from "./queries.js";
import { finalizeMojoModuleBindingTypes } from "./module-bindings.js";
import { finalizeMojoModuleEffects } from "./module-effects.js";
import { analyzeMojoModuleInitialization } from "./module-initialization.js";
import { finalizeMojoPublicModuleBindingAbis } from "./public-abi.js";
import {
  createMojoRepresentationCatalog,
  mojoCallableImplementationAdapterTypes,
  mojoObjectLiteralRepresentationTypes,
  mojoRepresentationParameters,
  mojoRepresentationRootTypes,
} from "../representations/index.js";
import { createMojoProjectDispatchPlan } from "../project-types/dispatch.js";
import { createMojoSourceCallableSpecializationPlan } from "../callables/specializations.js";
import { analyzeMojoCallableImplementationAdapters } from "../callables/implementation-adapters.js";
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
import {
  addMojoFirstClassFunctionBindings,
  selectMojoBinaryEntry,
} from "./program-entry-and-function-values.js";

export interface MojoProgramResultFinalizationInput {
  readonly request: MojoTargetAnalysisRequest;
  readonly sourceFiles: readonly SourceFile[];
  readonly diagnostics: TargetDiagnostic[];
  readonly environment: MojoExecutableRegionAnalysisEnvironment;
  readonly expressionErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly functions: readonly MojoAnalyzedFunction[];
  readonly topLevelCallableContracts: readonly import("./model.js").MojoAnalyzedCallableSignature[];
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
    topLevelCallableContracts,
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
    propertyNodes,
    valueSelections,
    intrinsicExpressionSelections,
    typeTestSelections,
    nullishCoalescingSelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    objectLiteralSelections,
    arrayLiteralSelections,
    bindingPatternSelections,
    bindingProjections,
    returnValueTransfers,
    fieldByDeclaration,
    locationStorageNames,
    executableRegionRoots,
  } = environment;
  const { ast } = checkedSource;
  const methodPropertyOwners = new Set<import("../../target-model/types/project.js").MojoProjectTypeDefinition>();
  for (const propertyNode of propertyNodes) {
    const selection = propertySelections.get(propertyNode);
    if (selection?.kind !== "project-method") continue;
    const finalizedType = expressionTypes.get(propertyNode);
    if (finalizedType?.kind === "callable") {
      propertySelections.set(propertyNode, Object.freeze({
        ...selection,
        callableType: finalizedType,
      }));
    }
    const owner = environment.projectRelationships.definitionContainingDeclaration(
      selection.declaration,
    );
    if (owner?.kind === "class") methodPropertyOwners.add(owner);
  }
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
      polymorphic: class_.polymorphic || methodPropertyOwners.has(class_.definition),
      ...(initializationErrorType === undefined ? {} : { initializationErrorType }),
      ...(typedError ? { errorRole: "typed" as const } : {}),
    });
  });
  const effectFinalizedModules = finalizeMojoModuleBindingTypes(finalizeMojoModuleEffects(
    analyzedModules,
    modules,
    moduleRegionFacts,
    errorTypesByDeclaration,
  ), bindingTypes);
  const firstClassFinalizedModules = addMojoFirstClassFunctionBindings(
    effectFinalizedModules,
    topLevelCallableContracts,
    finalizedByDeclaration,
    checkedSource,
    expressionTypes,
    bindingTypes,
    environment.conversions,
    environment.projectRelationships,
    diagnostics,
  );
  const finalizedModules = finalizeMojoPublicModuleBindingAbis(
    firstClassFinalizedModules,
    modules,
    environment.lifecycle,
    diagnostics,
  );
  const moduleInitialization = analyzeMojoModuleInitialization(finalizedModules, modules);
  for (const issue of moduleInitialization.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }
  for (const module of finalizedModules) {
    for (const binding of module.bindings) {
      moduleBindingByDeclaration.set(binding.declaration, binding);
      for (const reference of binding.references ?? []) {
        moduleBindingByDeclaration.set(reference, binding);
      }
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
  const finalizedModuleBySourceFile = new WeakMap(
    finalizedModules.map((module) => [module.sourceFile, module] as const),
  );
  const finalizedModuleById = new Map(
    finalizedModules.map((module) => [module.id, module] as const),
  );
  const stateDeclarationsById = new Map<string, MojoAnalyzedClass | MojoAnalyzedInterface>();
  for (const declaration of [...finalizedClasses, ...interfaces]) {
    if (declaration.targetType.kind === "target-named") {
      stateDeclarationsById.set(declaration.targetType.id, declaration);
    }
  }

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

  for (const [root, rootKind] of executableRegionRoots) {
    validateMojoExecutableRegionSyntax(
      root,
      rootKind,
      ast,
      callSelections,
      propertySelections,
      elementSelections,
      iterationSelections,
      valueSelections,
      intrinsicExpressionSelections,
      typeTestSelections,
      arrayLiteralSelections,
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
  const sourceCallableSpecializations = createMojoSourceCallableSpecializationPlan({
    ast,
    functions: finalizedFunctions,
    classes: finalizedClasses,
    interfaces,
    callNodes: environment.callNodes,
    callSelections,
    callableExpressionNodes,
    callableExpressionSelections,
    relationships: environment.projectRelationships,
    reservedNames,
    libraryOutput: configuration.outputType !== "bin",
  });
  for (const issue of sourceCallableSpecializations.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }
  const callableImplementationAdapterAnalysis = analyzeMojoCallableImplementationAdapters({
    topLevelContracts: topLevelCallableContracts,
    classes: finalizedClasses,
    implementations: finalizedByDeclaration,
    callableImplementation: (declaration) =>
      checkedSource.navigation.callableImplementation(declaration),
    relationships: environment.projectRelationships,
    specializations: sourceCallableSpecializations,
  });
  for (const issue of callableImplementationAdapterAnalysis.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
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
    intrinsicExpressionSelections,
    typeTestSelections,
    nullishCoalescingSelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    objectLiteralSelections,
    arrayLiteralSelections,
    callableExpressionSelections,
    templateExpressionSelections,
    bindingPatternSelections,
    bindingProjections,
    returnValueTransfers,
    catchErrorTypes,
    moduleBySourceFile: finalizedModuleBySourceFile,
    moduleById: finalizedModuleById,
    moduleBindingByDeclaration,
    locationStorageNames,
    stateDeclarationsById,
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
  const binaryEntry = selectMojoBinaryEntry(
    configuration.outputType,
    modules,
    topLevelFunctions,
    checkedSource.navigation,
    diagnostics,
  );
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);
  const projectDispatch = createMojoProjectDispatchPlan({
    classes: finalizedClasses,
    interfaces,
    relationships: environment.projectRelationships,
    modules,
    propertyNodes,
    propertySelections,
    implementations: finalizedByDeclaration,
    objectLiteralNodes,
    objectLiteralSelections,
    callableExpressionSelections,
    sourceCallableSpecializations,
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
    rootTypes: Object.freeze([
      ...mojoRepresentationRootTypes(declarations, finalizedModules),
      ...mojoCallableImplementationAdapterTypes(
        callableImplementationAdapterAnalysis.adapters,
      ),
      ...sourceCallableSpecializations.representationTypes,
      ...projectDispatch.representationTypes,
      ...mojoObjectLiteralRepresentationTypes(objectLiteralNodes, objectLiteralSelections),
      ...conversions.representationTypes(),
    ]),
    parameters: mojoRepresentationParameters(
      declarations,
      callableImplementationAdapterAnalysis.adapters,
    ),
    modules: finalizedModules,
    sourceModules: modules,
    authoredTypeAliases: typeAliases,
    sourceNavigation,
    callableNavigation: checkedSource.navigation,
    source: checkedSource,
    callableExpressionNodes,
    callableExpressionSelections,
    callableDeclarationByExpression,
    callSelections,
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
    sourceCallableSpecializations,
    projectDispatch,
    modules,
    analyzedModules: finalizedModules,
    moduleInitialization: moduleInitialization.catalog,
    ...(binaryEntry === undefined ? {} : { binaryEntry }),
    declarations: Object.freeze(declarations),
    callableImplementationAdapters: callableImplementationAdapterAnalysis.adapters,
    representations,
    lifecycle,
    queries,
    runtimePackages: analyzeMojoRuntimePackages(hostInput.runtimeReferences),
    binaryEpilogues: providerSemantics.binaryEpilogues,
    reservedNames: Object.freeze([
      ...new Set([...reservedNames, ...sourceCallableSpecializations.allocatedNames]),
    ].sort((left, right) => left.localeCompare(right, "en"))),
  }));
}
