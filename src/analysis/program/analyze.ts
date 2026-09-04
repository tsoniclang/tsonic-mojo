import type { Node, SourceFile } from "@tsonic/tsts";
import { rejectedTargetStage } from "@tsonic/target-api/artifacts";
import type {
  TargetDiagnostic,
  TargetStageResult,
} from "@tsonic/target-api/artifacts";
import { analyzeAndSealMojoCallableExpression } from "../callables/expressions.js";
import { createMojoConversionIndex } from "../../policy/conversions/selection.js";
import { mojoValueConversionNarrowing } from "../refinements/value.js";
import { createMojoProjectTypeCatalog } from "../project-types/catalog.js";
import { createMojoProjectTypeRelationships } from "../project-types/relationships.js";
import { createMojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { resolveMojoTargetType } from "../../policy/types/resolution.js";
import type {
  MojoAnalyzedProjectProperty,
  MojoArrayLiteralSelection,
  MojoBindingPatternSelection,
  MojoBindingProjectionPlan,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoIntrinsicExpressionSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTemplateExpressionSelection,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { analyzeMojoSourceModules } from "../source-modules/index.js";
import { analyzeMojoModuleBindings } from "./module-bindings.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import type { MojoAnalyzedModuleRegionFacts } from "./module-effects.js";
import { collectMojoDeclarationDrafts } from "./declaration-drafts.js";
import { collectMojoAddressedStorageDeclarations } from "./addressed-storage.js";
import { analyzeMojoProjectDeclarations } from "./declarations.js";
import { createMojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import { finalizeMojoProgramEffects } from "./program-effects-finalization.js";
import { finalizeMojoProgramResult } from "./program-result-finalization.js";
import {
  createMojoLifecycleResolver,
  createMojoValueOwnershipResolver,
} from "../lifecycle/index.js";
import { createMojoProgramNameEnvironment } from "./name-environment.js";
import { analyzeMojoProgramInitializationRegions } from "./initialization-regions.js";

export function analyzeMojoTargetProgram(
  request: MojoTargetAnalysisRequest,
): TargetStageResult<MojoTargetProgram> {
  return analyzeMojoTargetProgramWithCallableErrorDomain(request, undefined, 0);
}

function analyzeMojoTargetProgramWithCallableErrorDomain(
  request: MojoTargetAnalysisRequest,
  sourceCallableErrorType: MojoTargetTypeRef | undefined,
  errorDomainIteration: number,
): TargetStageResult<MojoTargetProgram> {
  const { input, configuration, providerSemantics, jsEnabled } = request;
  const { ast } = input.source;
  const sourceFiles = Object.freeze(input.source.sourceFiles.filter(
    (sourceFile): sourceFile is SourceFile =>
      sourceFile !== undefined &&
      !ast.isDeclarationFile(sourceFile),
  ));
  const sourceProfiles = createMojoSourceProfileRegistry(
    input.source.sourceFiles.filter((sourceFile): sourceFile is SourceFile => sourceFile !== undefined),
    ast,
    jsEnabled,
  );
  const diagnostics: TargetDiagnostic[] = [];
  const executableRegionRoots = new Map<
    Node,
    "expression" | "statement" | "declaration"
  >();
  const moduleAnalysis = analyzeMojoSourceModules(input, configuration.packageName, sourceFiles);
  if (moduleAnalysis.kind === "rejected") {
    return rejectedTargetStage(moduleAnalysis.issues.map((issue) => Object.freeze({
      code: issue.code,
      category: "error" as const,
      source: "tsonic-mojo",
      message: issue.message,
      ...(issue.node === undefined ? {} : { sourceNode: issue.node }),
      evidence: Object.freeze(["target.capability=mojo.analysis.source-modules"]),
    })));
  }
  const modules = moduleAnalysis.catalog;
  const bindingNames = new WeakMap<Node, string>();
  const bindingSourceFiles = new WeakMap<Node, SourceFile>();
  const bindingTypes = new WeakMap<Node, MojoTargetTypeRef>();
  const expressionTypes = new WeakMap<Node, MojoTargetTypeRef>();
  const expressionErrorTypes = new WeakMap<Node, MojoTargetTypeRef>();
  const callSelections = new WeakMap<Node, MojoCallSelection>();
  const callNodes = new Set<Node>();
  const callDependencies = new WeakMap<Node, Node>();
  const propertySelections = new WeakMap<Node, MojoPropertySelection>();
  const propertyNodes = new Set<Node>();
  const elementSelections = new WeakMap<Node, MojoElementSelection>();
  const iterationSelections = new WeakMap<Node, MojoIterationSelection>();
  const resourceManagementSelections = new WeakMap<Node, MojoResourceManagementSelection>();
  const resourceDeclarations = new Set<Node>();
  const valueSelections = new WeakMap<Node, MojoValueSelection>();
  const intrinsicExpressionSelections = new WeakMap<Node, MojoIntrinsicExpressionSelection>();
  const valueRefinements = new WeakMap<Node, MojoValueRefinementSelection>();
  const typeTestSelections = new WeakMap<Node, MojoTypeTestSelection>();
  const nullishCoalescingSelections = new WeakMap<Node, import("./model.js").MojoNullishCoalescingSelection>();
  const objectLiteralSelections = new WeakMap<Node, MojoObjectLiteralSelection>();
  const arrayLiteralSelections = new WeakMap<Node, MojoArrayLiteralSelection>();
  const objectLiteralNodes = new Set<Node>();
  const callableExpressionSelections = new WeakMap<Node, MojoCallableExpressionSelection>();
  const callableExpressionNodes = new Set<Node>();
  const callableExpressionByDeclaration = new WeakMap<Node, Node>();
  const callableDeclarationByExpression = new WeakMap<Node, Node>();
  const templateExpressionSelections = new WeakMap<Node, MojoTemplateExpressionSelection>();
  const templateExpressionNodes = new Set<Node>();
  const bindingPatternSelections = new WeakMap<Node, MojoBindingPatternSelection>();
  const bindingProjections = new WeakMap<Node, MojoBindingProjectionPlan>();
  const returnValueTransfers = new WeakSet<Node>();
  const analyzedCallableExpressions = new WeakSet<Node>();
  const structuralObjects = createMojoStructuralObjectCatalog(ast);
  const fieldByDeclaration = new WeakMap<Node, MojoAnalyzedProjectProperty>();
  const moduleBindingByDeclaration = new WeakMap<
    Node,
    import("./model.js").MojoAnalyzedModuleBinding
  >();
  const classInitializationRoots = new Map<Node, Node[]>();
  const functionEffectRoots = new Map<Node, Node[]>();
  const moduleEffectRoots = new WeakMap<import("./model.js").MojoAnalyzedModule, Node[]>();
  const sourceValueOccurrenceKinds = new WeakMap<Node, "runtime" | "non-runtime">();
  const indexedSourceUseDeclarations = new WeakSet<Node>();
  const addressedStorageDeclarations = collectMojoAddressedStorageDeclarations(
    sourceFiles,
    input.source,
  );
  const locationStorageNames = new WeakMap<Node, string>();
  const {
    reservedNames,
    createNameAllocator,
    globalNames,
    unownedGlobalNames,
  } = createMojoProgramNameEnvironment();
  const globalNameByDeclaration = new WeakMap<Node, string>();
  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) continue;
      const nameNode = ast.name(statement);
      if (nameNode !== undefined && ast.is.IsIdentifier(nameNode)) {
        const role = ast.is.IsClassDeclaration(statement) ||
            ast.is.IsInterfaceDeclaration(statement) || ast.is.IsEnumDeclaration(statement) ||
            ast.is.IsTypeAliasDeclaration(statement)
          ? "type"
          : "value";
        const implementation = ast.is.IsFunctionDeclaration(statement)
          ? input.source.navigation.callableImplementation(statement)
          : undefined;
        const nameOwner = implementation?.kind === "resolved"
          ? implementation.implementation.declaration
          : statement;
        const nameSourceFile = implementation?.kind === "resolved"
          ? implementation.implementation.sourceFile
          : sourceFile;
        const selectedName = globalNameByDeclaration.get(nameOwner) ??
          globalNames(nameSourceFile)(ast.text(nameNode), role);
        globalNameByDeclaration.set(nameOwner, selectedName);
        globalNameByDeclaration.set(statement, selectedName);
        bindingSourceFiles.set(statement, sourceFile);
      }
    }
  }
  const projectTypes = createMojoProjectTypeCatalog(
    input.source,
    sourceFiles,
    (declaration, sourceName) => {
      const sourceFile = ast.getSourceFile(declaration);
      return globalNameByDeclaration.get(declaration) ??
        (sourceFile === undefined
          ? unownedGlobalNames(sourceName, "type")
          : globalNames(sourceFile)(sourceName, "type"));
    },
    (sourceFile) => modules.forSourceFile(sourceFile)?.modulePath ?? Object.freeze([]),
  );
  for (const issue of projectTypes.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }
  const projectRelationships = createMojoProjectTypeRelationships({
    source: input.source,
    projectTypes,
    resolveSelectedType(selectedType, authoredTypeNode, evidence) {
      const sourceFile = ast.getSourceFile(evidence);
      if (sourceFile === undefined) return undefined;
      const resolved = resolveMojoTargetType(selectedType, authoredTypeNode, {
        ast,
        navigation: input.source.navigation,
        semantics: input.source.semantics.forFile(sourceFile),
        sourceFacts: input.source.sourceFacts,
        providerSemantics,
        projectTypes,
        sourceProfiles,
        jsEnabled,
        ...(sourceCallableErrorType === undefined ? {} : { sourceCallableErrorType }),
      });
      return resolved.kind === "resolved" ? resolved.type : undefined;
    },
  });
  for (const issue of projectRelationships.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }
  const conversions = createMojoConversionIndex(
    (expression) => mojoValueConversionNarrowing(valueRefinements.get(expression)),
    projectRelationships,
  );
  const lifecycle = createMojoLifecycleResolver({ projectTypes, providerSemantics });
  const valueOwnership = createMojoValueOwnershipResolver({
    source: input.source,
    expressionTypes,
    callSelections,
    objectLiteralSelections,
  });
  const analyzedModules = analyzeMojoModuleBindings({
    source: input.source,
    sourceFiles,
    modules,
    providerSemantics,
    projectTypes,
    sourceProfiles,
    jsEnabled,
    ...(sourceCallableErrorType === undefined ? {} : { sourceCallableErrorType }),
    diagnostics,
    allocateModuleName(sourceFile, name) {
      return globalNames(sourceFile)(name);
    },
    allocateModuleTypeName(sourceFile, name) {
      return globalNames(sourceFile)(name, "type");
    },
    bindName(declaration, name) {
      bindingNames.set(declaration, name);
    },
    bindSourceFile(declaration, sourceFile) {
      bindingSourceFiles.set(declaration, sourceFile);
    },
    bindType(declaration, type) {
      bindingTypes.set(declaration, type);
    },
  });
  for (const module of analyzedModules) {
    for (const binding of module.bindings) {
      moduleBindingByDeclaration.set(binding.declaration, binding);
      if (binding.kind === "class-static-field") {
        fieldByDeclaration.set(binding.declaration, Object.freeze({
          kind: "static-field",
          declaration: binding.declaration,
          sourceFile: binding.sourceFile,
          sourceName: binding.sourceName,
          name: binding.name,
          type: binding.type,
          binding,
        }));
      }
    }
  }
  const drafts = collectMojoDeclarationDrafts({
    sourceFiles,
    ast,
    globalNameByDeclaration,
    globalNames,
    bindingNames,
    bindingSourceFiles,
    createNameAllocator,
    diagnostics,
  });

  const {
    functions,
    topLevelCallableContracts,
    classes,
    interfaces,
    enums,
    typeAliases,
    functionByDeclaration,
    callableByDeclaration,
    classByDeclaration,
    classByTypeId,
    interfaceByTypeId,
  } = analyzeMojoProjectDeclarations({
    source: input.source,
    providerSemantics,
    projectTypes,
    projectRelationships,
    modules,
    lifecycle,
    sourceProfiles,
    jsEnabled,
    ...(sourceCallableErrorType === undefined ? {} : { sourceCallableErrorType }),
    drafts,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    fieldByDeclaration,
    createNameAllocator,
    diagnostics,
  });

  const locationNames = createNameAllocator();
  for (const declaration of addressedStorageDeclarations) {
    const bindingName = bindingNames.get(declaration);
    if (bindingName !== undefined) {
      locationStorageNames.set(declaration, locationNames(`${bindingName}_location`));
    }
  }

  let executableEnvironment: MojoExecutableRegionAnalysisEnvironment;
  const analyzeCallableExpression = (
    expression: Node,
    sourceFile: SourceFile,
    owner: import("./model.js").MojoAnalyzedClassOwner | undefined,
    options: {
      readonly selectedType?: import("@tsonic/tsts").Type;
      readonly kind?: import("./model.js").MojoAnalyzedCallableKind;
      readonly name?: string;
      readonly allowAsynchronous?: boolean;
      readonly captureSelf?: boolean;
    } = {},
  ): MojoCallableExpressionSelection | undefined => {
    analyzeAndSealMojoCallableExpression({
      expression,
      sourceFile,
      ...(owner === undefined ? {} : { owner }),
      ...(options.selectedType === undefined ? {} : { selectedType: options.selectedType }),
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.name === undefined ? {} : { name: options.name }),
      ...(options.allowAsynchronous === true ? { allowAsynchronous: true } : {}),
      ...(options.captureSelf === false ? { captureSelf: false } : {}),
      allocateLocalName: createNameAllocator(),
      ensureLocationStorage(declaration, bindingName) {
        const existing = locationStorageNames.get(declaration);
        if (existing !== undefined) return existing;
        const name = locationNames(`${bindingName}_location`);
        locationStorageNames.set(declaration, name);
        return name;
      },
      moduleBindingByDeclaration,
      selections: callableExpressionSelections,
      byDeclaration: callableExpressionByDeclaration,
      declarationByExpression: callableDeclarationByExpression,
      analyzed: analyzedCallableExpressions,
      environment: executableEnvironment,
    });
    if (callableExpressionSelections.get(expression) !== undefined) {
      callableExpressionNodes.add(expression);
    }
    return callableExpressionSelections.get(expression);
  };
  executableEnvironment = {
    source: input.source,
    providerSemantics,
    projectTypes,
    projectRelationships,
    lifecycle,
    valueOwnership,
    sourceProfiles,
    modules,
    jsEnabled,
    ...(sourceCallableErrorType === undefined ? {} : { sourceCallableErrorType }),
    diagnostics,
    executableRegionRoots,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    callSelections,
    callNodes,
    callDependencies,
    propertySelections,
    propertyNodes,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    resourceDeclarations,
    valueSelections,
    intrinsicExpressionSelections,
    valueRefinements,
    typeTestSelections,
    nullishCoalescingSelections,
    objectLiteralSelections,
    arrayLiteralSelections,
    objectLiteralNodes,
    templateExpressionNodes,
    bindingPatternSelections,
    bindingProjections,
    returnValueTransfers,
    structuralObjects,
    analyzeCallableExpression,
    conversions,
    functionByDeclaration,
    callableByDeclaration,
    classByDeclaration,
    classByTypeId,
    locationStorageNames,
    interfaceByTypeId,
    fieldByDeclaration,
    sourceValueOccurrenceKinds,
    indexedSourceUseDeclarations,
  };

  const moduleRegionFacts = new WeakMap<
    import("./model.js").MojoAnalyzedModule,
    MojoAnalyzedModuleRegionFacts
  >();
  analyzeMojoProgramInitializationRegions({
    analyzedModules,
    classes,
    functions,
    environment: executableEnvironment,
    classInitializationRoots,
    moduleEffectRoots,
    functionEffectRoots,
    createNameAllocator,
  });

  const effects = finalizeMojoProgramEffects({
    sourceFiles,
    environment: executableEnvironment,
    expressionErrorTypes,
    ...(sourceCallableErrorType === undefined ? {} : { sourceCallableErrorType }),
    errorDomainIteration,
    functions,
    classes,
    analyzedModules,
    functionEffectRoots,
    classInitializationRoots,
    moduleEffectRoots,
    callableExpressionNodes,
    callableExpressionSelections,
    callableExpressionByDeclaration,
    callableDeclarationByExpression,
    moduleRegionFacts,
  });
  if (effects.kind === "reanalyze") {
    return analyzeMojoTargetProgramWithCallableErrorDomain(
      request,
      effects.sourceCallableErrorType,
      errorDomainIteration + 1,
    );
  }
  return finalizeMojoProgramResult({
    request,
    sourceFiles,
    diagnostics,
    environment: executableEnvironment,
    expressionErrorTypes,
    functions,
    topLevelCallableContracts,
    classes,
    interfaces,
    enums,
    typeAliases,
    analyzedModules,
    moduleRegionFacts,
    errorTypesByDeclaration: effects.errorTypesByDeclaration,
    catchErrorTypes: effects.catchErrorTypes,
    callableExpressionSelections,
    callableExpressionNodes,
    objectLiteralNodes,
    callableDeclarationByExpression,
    templateExpressionSelections,
    templateExpressionNodes,
    moduleBindingByDeclaration,
    reservedNames,
  });
}
