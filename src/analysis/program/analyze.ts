import type { Node, SourceFile } from "@tsonic/tsts";
import { rejectedTargetStage } from "@tsonic/target-api/artifacts";
import type {
  TargetDiagnostic,
  TargetStageResult,
} from "@tsonic/target-api/artifacts";
import { createMojoNameAllocator } from "../names/allocator.js";
import {
  normalizeMojoConstantIdentifier,
  normalizeMojoIdentifier,
  normalizeMojoPackageDeclarationIdentifier,
  normalizeMojoTypeIdentifier,
} from "../../target-model/names/identifiers.js";
import { analyzeAndSealMojoCallableExpression } from "../callables/expressions.js";
import { createMojoConversionIndex } from "../../policy/conversions/selection.js";
import { mojoValueConversionNarrowing } from "../refinements/value.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";
import { createMojoProjectTypeCatalog } from "../project-types/catalog.js";
import { createMojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import type {
  MojoAnalyzedProjectProperty,
  MojoBindingPatternSelection,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
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
import { analyzeMojoExecutableRegion } from "./executable-regions.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import { allocateMojoLocalBindings } from "./local-bindings.js";
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
  const elementSelections = new WeakMap<Node, MojoElementSelection>();
  const iterationSelections = new WeakMap<Node, MojoIterationSelection>();
  const resourceManagementSelections = new WeakMap<Node, MojoResourceManagementSelection>();
  const resourceDeclarations = new Set<Node>();
  const valueSelections = new WeakMap<Node, MojoValueSelection>();
  const valueRefinements = new WeakMap<Node, MojoValueRefinementSelection>();
  const typeTestSelections = new WeakMap<Node, MojoTypeTestSelection>();
  const nullishCoalescingSelections = new WeakMap<Node, import("./model.js").MojoNullishCoalescingSelection>();
  const objectLiteralSelections = new WeakMap<Node, MojoObjectLiteralSelection>();
  const callableExpressionSelections = new WeakMap<Node, MojoCallableExpressionSelection>();
  const callableExpressionNodes = new Set<Node>();
  const callableExpressionByDeclaration = new WeakMap<Node, Node>();
  const callableDeclarationByExpression = new WeakMap<Node, Node>();
  const templateExpressionSelections = new WeakMap<Node, MojoTemplateExpressionSelection>();
  const templateExpressionNodes = new Set<Node>();
  const bindingPatternSelections = new WeakMap<Node, MojoBindingPatternSelection>();
  const returnValueTransfers = new WeakSet<Node>();
  const analyzedCallableExpressions = new WeakSet<Node>();
  const conversions = createMojoConversionIndex((expression) =>
    mojoValueConversionNarrowing(valueRefinements.get(expression)));
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
  const reservedNames = new Set<string>();
  type NameRole = "value" | "type" | "constant";
  const normalizer = (role: NameRole): ((name: string) => string) =>
    role === "type"
      ? normalizeMojoTypeIdentifier
      : role === "constant"
        ? normalizeMojoConstantIdentifier
        : normalizeMojoIdentifier;
  const createNameAllocator = (role: NameRole = "value"): ((name: string) => string) =>
    createMojoNameAllocator([], (name) => reservedNames.add(name), normalizer(role));
  const globalNamesBySourceFile = new WeakMap<SourceFile, (
    name: string,
    role?: NameRole,
  ) => string>();
  const createGlobalNameAllocator = (): ((name: string, role?: NameRole) => string) => {
    const used = new Set<string>();
    return (name, role = "value") => {
      const normalized = role === "value"
        ? normalizeMojoPackageDeclarationIdentifier(name)
        : normalizer(role)(name);
      let candidate = normalized;
      let suffix = 2;
      while (used.has(candidate)) candidate = `${normalized}_${suffix++}`;
      used.add(candidate);
      reservedNames.add(candidate);
      return candidate;
    };
  };
  const unownedGlobalNames = createGlobalNameAllocator();
  const globalNames = (sourceFile: SourceFile): ((name: string, role?: NameRole) => string) => {
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
        const role: NameRole = ast.is.IsClassDeclaration(statement) ||
            ast.is.IsInterfaceDeclaration(statement) || ast.is.IsEnumDeclaration(statement) ||
            ast.is.IsTypeAliasDeclaration(statement)
          ? "type"
          : "value";
        globalNameByDeclaration.set(statement, globalNames(sourceFile)(ast.text(nameNode), role));
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
    classes,
    interfaces,
    enums,
    typeAliases,
    functionByDeclaration,
    classByDeclaration,
    classByTypeId,
    interfaceByTypeId,
  } = analyzeMojoProjectDeclarations({
    source: input.source,
    providerSemantics,
    projectTypes,
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
      byDeclaration: callableExpressionByDeclaration,
      declarationByExpression: callableDeclarationByExpression,
      analyzed: analyzedCallableExpressions,
      environment: executableEnvironment,
    });
    if (callableExpressionSelections.get(expression) !== undefined) {
      callableExpressionNodes.add(expression);
    }
  };
  executableEnvironment = {
    source: input.source,
    providerSemantics,
    projectTypes,
    lifecycle,
    valueOwnership,
    sourceProfiles,
    modules,
    jsEnabled,
    ...(sourceCallableErrorType === undefined ? {} : { sourceCallableErrorType }),
    diagnostics,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    callSelections,
    callNodes,
    callDependencies,
    propertySelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    resourceDeclarations,
    valueSelections,
    valueRefinements,
    typeTestSelections,
    nullishCoalescingSelections,
    objectLiteralSelections,
    templateExpressionNodes,
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
    const roots: Node[] = [];
    for (const field of class_.fields) {
      if (field.initializer === undefined) continue;
      roots.push(field.initializer);
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
        valueRefinements,
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
    classInitializationRoots.set(class_.declaration, roots);
  }

  const moduleRegionFacts = new WeakMap<
    import("./model.js").MojoAnalyzedModule,
    MojoAnalyzedModuleRegionFacts
  >();
  for (const module of analyzedModules) {
    const roots: Node[] = [];
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
      roots.push(root);
      analyzeMojoExecutableRegion({
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
        valueRefinements,
        conversions,
        diagnostics,
      );
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
    moduleEffectRoots.set(module, roots);
  }

  for (const function_ of functions) {
    const roots: Node[] = [];
    for (const parameter of function_.parameters) {
      if (parameter.omissionKind !== "initializer" || parameter.initializer === undefined) continue;
      roots.push(parameter.initializer);
      analyzeMojoExecutableRegion({
        root: parameter.initializer,
        sourceFile: function_.sourceFile,
        rootExpectedType: parameter.bodyType,
        ...(function_.owner === undefined ? {} : { owner: function_.owner }),
        ...executableEnvironment,
      });
      recordMojoExecutableRegionConversionUses(
        parameter.initializer,
        undefined,
        ast,
        bindingTypes,
        expressionTypes,
        callSelections,
        propertySelections,
        elementSelections,
        objectLiteralSelections,
        valueRefinements,
        conversions,
        diagnostics,
      );
      const actual = expressionTypes.get(parameter.initializer);
      if (actual === undefined) {
        diagnostics.push(diagnostic(
          "MOJO_DEFAULT_PARAMETER_INITIALIZER_CARRIER_NOT_CLOSED",
          "A default parameter initializer requires one exact sealed Mojo carrier.",
          parameter.initializer,
        ));
      } else {
        const conversion = conversions.record(parameter.initializer, actual, parameter.bodyType);
        if (conversion.kind === "unsupported") {
          diagnostics.push(diagnostic(
            "MOJO_VALUE_CONVERSION_UNPROVEN",
            conversion.reason,
            parameter.initializer,
          ));
        }
      }
    }
    roots.push(function_.body);
    analyzeMojoExecutableRegion({
      root: function_.body,
      sourceFile: function_.sourceFile,
      returnType: function_.resultType,
      ...(function_.owner === undefined ? {} : { owner: function_.owner }),
      ...executableEnvironment,
    });
    if (function_.kind === "constructor" && function_.owner !== undefined) {
      const class_ = classes.find((candidate) => candidate.targetType.kind === "target-named" &&
        function_.owner?.type.kind === "target-named" &&
        candidate.targetType.id === function_.owner.type.id);
      if (class_ !== undefined) {
        roots.push(...(classInitializationRoots.get(class_.declaration) ?? []));
      }
    }
    functionEffectRoots.set(function_.declaration, roots);
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
      valueRefinements,
      conversions,
      diagnostics,
    );
  }

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
    callableDeclarationByExpression,
    templateExpressionSelections,
    templateExpressionNodes,
    moduleBindingByDeclaration,
    reservedNames,
  });
}
