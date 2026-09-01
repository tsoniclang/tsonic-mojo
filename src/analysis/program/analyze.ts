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
import { createMojoNameAllocator } from "../names/allocator.js";
import {
  normalizeMojoPackageDeclarationIdentifier,
} from "../../target-model/names/identifiers.js";
import {
  analyzeAndSealMojoCallableExpression,
} from "../callables/expressions.js";
import { createMojoConversionIndex } from "../../policy/conversions/selection.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import { createMojoProjectTypeCatalog } from "../project-types/catalog.js";
import { createMojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import {
  propagateRaisingEffects,
} from "./effects.js";
import type {
  MojoAnalyzedDeclaration,
  MojoAnalyzedFunction,
  MojoAnalyzedProjectProperty,
  MojoBindingPatternSelection,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { validateMojoFunctionSyntax } from "./syntax-validation.js";
import { analyzeMojoSourceModules } from "../source-modules/index.js";
import { analyzeMojoModuleBindings } from "./module-bindings.js";
import { analyzeMojoExecutableRegion } from "./executable-regions.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import { allocateMojoLocalBindings } from "./local-bindings.js";
import {
  finalizeMojoModuleEffects,
} from "./module-effects.js";
import type { MojoAnalyzedModuleRegionFacts } from "./module-effects.js";
import { createMojoProgramQueries } from "./queries.js";
import { collectMojoDeclarationDrafts } from "./declaration-drafts.js";
import { collectMojoAddressedStorageDeclarations } from "./addressed-storage.js";
import { analyzeMojoProjectDeclarations } from "./declarations.js";
import { createMojoStructuralObjectCatalog } from "../bindings/structural-objects.js";

export function analyzeMojoTargetProgram(
  request: MojoTargetAnalysisRequest,
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
  const callSelections = new WeakMap<Node, MojoCallSelection>();
  const propertySelections = new WeakMap<Node, MojoPropertySelection>();
  const elementSelections = new WeakMap<Node, MojoElementSelection>();
  const iterationSelections = new WeakMap<Node, MojoIterationSelection>();
  const resourceManagementSelections = new WeakMap<Node, MojoResourceManagementSelection>();
  const resourceDeclarations = new Set<Node>();
  const valueSelections = new WeakMap<Node, MojoValueSelection>();
  const valueRefinements = new WeakMap<Node, MojoValueRefinementSelection>();
  const typeTestSelections = new WeakMap<Node, MojoTypeTestSelection>();
  const objectLiteralSelections = new WeakMap<Node, MojoObjectLiteralSelection>();
  const callableExpressionSelections = new WeakMap<Node, MojoCallableExpressionSelection>();
  const bindingPatternSelections = new WeakMap<Node, MojoBindingPatternSelection>();
  const returnValueTransfers = new WeakSet<Node>();
  const analyzedCallableExpressions = new WeakSet<Node>();
  const conversions = createMojoConversionIndex();
  const structuralObjects = createMojoStructuralObjectCatalog(ast);
  const fieldByDeclaration = new WeakMap<Node, MojoAnalyzedProjectProperty>();
  const moduleBindingByDeclaration = new WeakMap<
    Node,
    import("./model.js").MojoAnalyzedModuleBinding
  >();
  const directRaises = new Map<Node, boolean>();
  const projectDependencies = new Map<Node, Set<Node>>();
  const sourceValueOccurrenceKinds = new WeakMap<Node, "runtime" | "non-runtime">();
  const indexedSourceUseDeclarations = new WeakSet<Node>();
  const addressedStorageDeclarations = collectMojoAddressedStorageDeclarations(
    sourceFiles,
    input.source,
  );
  const locationStorageNames = new WeakMap<Node, string>();
  const reservedNames = new Set<string>();
  const createNameAllocator = (): ((name: string) => string) =>
    createMojoNameAllocator([], (name) => reservedNames.add(name));
  const globalNamesBySourceFile = new WeakMap<SourceFile, (name: string) => string>();
  const createGlobalNameAllocator = (): ((name: string) => string) =>
    createMojoNameAllocator(
      [],
      (name) => reservedNames.add(name),
      normalizeMojoPackageDeclarationIdentifier,
    );
  const unownedGlobalNames = createGlobalNameAllocator();
  const globalNames = (sourceFile: SourceFile): ((name: string) => string) => {
    const existing = globalNamesBySourceFile.get(sourceFile);
    if (existing !== undefined) return existing;
    const created = createGlobalNameAllocator();
    globalNamesBySourceFile.set(sourceFile, created);
    return created;
  };
  const globalNameByDeclaration = new WeakMap<Node, string>();
  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined) continue;
      const nameNode = ast.name(statement);
      if (nameNode !== undefined && ast.is.IsIdentifier(nameNode)) {
        globalNameByDeclaration.set(statement, globalNames(sourceFile)(ast.text(nameNode)));
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
        (sourceFile === undefined ? unownedGlobalNames(sourceName) : globalNames(sourceFile)(sourceName));
    },
    (sourceFile) => modules.forSourceFile(sourceFile)?.modulePath ?? Object.freeze([]),
  );
  for (const issue of projectTypes.issues) {
    diagnostics.push(diagnostic(issue.code, issue.message, issue.node));
  }
  const analyzedModules = analyzeMojoModuleBindings({
    source: input.source,
    sourceFiles,
    modules,
    providerSemantics,
    projectTypes,
    sourceProfiles,
    jsEnabled,
    diagnostics,
    allocateModuleName(sourceFile, name) {
      return globalNames(sourceFile)(name);
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
    classes,
    interfaces,
    enums,
    functionByDeclaration,
    classByDeclaration,
    classByTypeId,
    interfaceByTypeId,
  } = analyzeMojoProjectDeclarations({
    source: input.source,
    providerSemantics,
    projectTypes,
    sourceProfiles,
    jsEnabled,
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
  ): void => {
    analyzeAndSealMojoCallableExpression({
      expression,
      sourceFile,
      ...(owner === undefined ? {} : { owner }),
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
      analyzed: analyzedCallableExpressions,
      environment: executableEnvironment,
    });
  };
  executableEnvironment = {
    source: input.source,
    providerSemantics,
    projectTypes,
    sourceProfiles,
    modules,
    jsEnabled,
    diagnostics,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    callSelections,
    propertySelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    resourceDeclarations,
    valueSelections,
    valueRefinements,
    typeTestSelections,
    objectLiteralSelections,
    bindingPatternSelections,
    returnValueTransfers,
    structuralObjects,
    analyzeCallableExpression,
    conversions,
    functionByDeclaration,
    classByDeclaration,
    classByTypeId,
    locationStorageNames,
    interfaceByTypeId,
    fieldByDeclaration,
    sourceValueOccurrenceKinds,
    indexedSourceUseDeclarations,
  };

  for (const class_ of classes) {
    for (const field of class_.fields) {
      analyzeMojoExecutableRegion({
        root: field.initializer,
        sourceFile: class_.sourceFile,
        rootExpectedType: field.type,
        owner: Object.freeze({ name: class_.name, stateName: class_.stateName, type: class_.targetType }),
        ...executableEnvironment,
      });
      recordMojoExecutableRegionConversionUses(
        field.initializer,
        undefined,
        ast,
        bindingTypes,
        expressionTypes,
        callSelections,
        propertySelections,
        elementSelections,
        objectLiteralSelections,
        conversions,
        diagnostics,
      );
      const actual = expressionTypes.get(field.initializer);
      if (actual === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_CLASS_FIELD_INITIALIZER_CARRIER_NOT_CLOSED",
          "Class field initializer has no sealed Mojo carrier.",
          field.initializer,
        ));
        continue;
      }
      const conversion = conversions.record(field.initializer, actual, field.type);
      if (conversion.kind === "unsupported") {
        diagnostics.push(diagnostic("MOJO_VALUE_CONVERSION_UNPROVEN", conversion.reason, field.initializer));
      }
    }
  }

  const moduleRegionFacts = new WeakMap<
    import("./model.js").MojoAnalyzedModule,
    MojoAnalyzedModuleRegionFacts
  >();
  for (const module of analyzedModules) {
    const dependencies = new Set<Node>();
    let directModuleRaises = false;
    for (const step of module.initializationSteps) {
      if (step.kind === "class-static-block") {
        allocateMojoLocalBindings(
          step.body,
          createNameAllocator(),
          bindingNames,
          ast,
          diagnostics,
          bindingSourceFiles,
        );
      }
      const resourceBinding = step.kind === "binding" &&
        (step.binding.declarationKind === "using" || step.binding.declarationKind === "await using");
      const root = step.kind === "binding"
        ? resourceBinding ? step.binding.declaration : step.binding.initializer
        : step.kind === "statement" ? step.statement
        : step.body;
      const region = analyzeMojoExecutableRegion({
        root,
        sourceFile: module.sourceFile,
        ...(step.kind === "binding" && !resourceBinding
          ? { rootExpectedType: step.binding.type }
          : {}),
        ...executableEnvironment,
      });
      recordMojoExecutableRegionConversionUses(
        root,
        undefined,
        ast,
        bindingTypes,
        expressionTypes,
        callSelections,
        propertySelections,
        elementSelections,
        objectLiteralSelections,
        conversions,
        diagnostics,
      );
      for (const dependency of region.dependencies) dependencies.add(dependency);
      directModuleRaises = directModuleRaises || region.raises;
      if (step.kind !== "binding") continue;
      const actual = expressionTypes.get(step.binding.initializer);
      if (actual === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_MODULE_INITIALIZER_CARRIER_NOT_CLOSED",
          `Module binding '${step.binding.sourceName}' has no sealed initializer carrier.`,
          step.binding.initializer,
        ));
        continue;
      }
      const conversion = conversions.record(step.binding.initializer, actual, step.binding.type);
      if (conversion.kind === "unsupported") {
        diagnostics.push(diagnostic(
          "MOJO_VALUE_CONVERSION_UNPROVEN",
          conversion.reason,
          step.binding.initializer,
        ));
      }
    }
    moduleRegionFacts.set(module, Object.freeze({ dependencies, directRaises: directModuleRaises }));
  }

  for (const function_ of functions) {
    const region = analyzeMojoExecutableRegion({
      root: function_.body,
      sourceFile: function_.sourceFile,
      returnType: function_.resultType,
      ...(function_.owner === undefined ? {} : { owner: function_.owner }),
      ...executableEnvironment,
    });
    projectDependencies.set(function_.declaration, new Set(region.dependencies));
    recordMojoExecutableRegionConversionUses(
      function_.body,
      function_.resultType,
      ast,
      bindingTypes,
      expressionTypes,
      callSelections,
      propertySelections,
      elementSelections,
      objectLiteralSelections,
      conversions,
      diagnostics,
    );
    directRaises.set(function_.declaration, region.raises);
  }

  const raisesByDeclaration = propagateRaisingEffects(
    functions,
    directRaises,
    projectDependencies,
  );
  for (const declaration of resourceDeclarations) {
    const selection = resourceManagementSelections.get(declaration);
    if (selection === undefined || !selection.alternatives.some(({ disposal }) =>
      disposal.kind === "project")) continue;
    resourceManagementSelections.set(declaration, Object.freeze({
      ...selection,
      alternatives: Object.freeze(selection.alternatives.map((alternative) =>
        alternative.disposal.kind !== "project"
          ? alternative
          : Object.freeze({
              ...alternative,
              disposal: Object.freeze({
                ...alternative.disposal,
                raises: raisesByDeclaration.get(alternative.disposal.dependency) === true,
              }),
            }))),
    }));
  }
  const finalizedFunctions = functions.map((function_) => Object.freeze({
    ...function_,
    raises: raisesByDeclaration.get(function_.declaration) === true,
  }));
  const finalizedByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  for (const function_ of finalizedFunctions) finalizedByDeclaration.set(function_.declaration, function_);
  const finalizedClasses = classes.map((class_) => Object.freeze({
    ...class_,
    methods: Object.freeze(class_.methods.map((method) => finalizedByDeclaration.get(method.declaration) ?? method)),
    constructors: Object.freeze(class_.constructors.map((constructor) =>
      finalizedByDeclaration.get(constructor.declaration) ?? constructor)),
  }));
  const finalizedModules = finalizeMojoModuleEffects(
    analyzedModules,
    modules,
    moduleRegionFacts,
    finalizedByDeclaration,
  );
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
      diagnostics,
    );
  }
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);

  const source = targetSourceSyntaxProgram(input.source);
  const sourceNavigation = snapshotTargetPlanningSourceNavigation(input.source);
  const queries = createMojoProgramQueries({
    sourceNavigation,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    conversions,
    callSelections,
    propertySelections,
    valueSelections,
    valueRefinements,
    typeTestSelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    objectLiteralSelections,
    callableExpressionSelections,
    bindingPatternSelections,
    returnValueTransfers,
    moduleBySourceFile: finalizedModuleBySourceFile,
    moduleBindingByDeclaration,
    locationStorageNames,
  });
  const topLevelFunctions = finalizedFunctions.filter((function_) => function_.kind === "function");
  const declarations: MojoAnalyzedDeclaration[] = [
    ...topLevelFunctions,
    ...finalizedClasses,
    ...interfaces,
    ...enums,
  ];
  return resolvedTargetStage(Object.freeze({
    host: Object.freeze({
      paths: Object.freeze({ ...input.paths }),
      entryPoint: input.project.entryPoint,
      sourcePackages: input.sourcePackages,
    }),
    configuration,
    source,
    sourceNavigation,
    sourceFiles,
    projectTypes,
    modules,
    analyzedModules: finalizedModules,
    declarations: Object.freeze(declarations),
    queries,
    runtimePackages: analyzeMojoRuntimePackages(input.runtimeReferences),
    binaryEpilogues: providerSemantics.binaryEpilogues,
    reservedNames: Object.freeze([...reservedNames].sort((left, right) => left.localeCompare(right, "en"))),
  }));
}
