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
import { analyzeMojoFunctionSignature } from "../callables/signatures.js";
import {
  analyzeAndSealMojoCallableExpression,
} from "../callables/expressions.js";
import { analyzeMojoClass } from "../declarations/classes.js";
import { analyzeMojoEnum } from "../declarations/enums.js";
import { analyzeMojoInterface } from "../declarations/interfaces.js";
import { createMojoConversionIndex } from "../../policy/conversions/selection.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import { createMojoProjectTypeCatalog } from "../project-types/catalog.js";
import { createMojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import {
  propagateRaisingEffects,
} from "./effects.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedDeclaration,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedProjectProperty,
  MojoBindingPatternSelection,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
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
  const valueSelections = new WeakMap<Node, MojoValueSelection>();
  const objectLiteralSelections = new WeakMap<Node, MojoObjectLiteralSelection>();
  const callableExpressionSelections = new WeakMap<Node, MojoCallableExpressionSelection>();
  const bindingPatternSelections = new WeakMap<Node, MojoBindingPatternSelection>();
  const analyzedCallableExpressions = new WeakSet<Node>();
  const conversions = createMojoConversionIndex();
  const functionByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  const classByDeclaration = new WeakMap<Node, MojoAnalyzedClass>();
  const classByTypeId = new Map<string, MojoAnalyzedClass>();
  const interfaceByTypeId = new Map<string, MojoAnalyzedInterface>();
  const fieldByDeclaration = new WeakMap<Node, MojoAnalyzedProjectProperty>();
  const moduleBindingByDeclaration = new WeakMap<
    Node,
    import("./model.js").MojoAnalyzedModuleBinding
  >();
  const directRaises = new Map<Node, boolean>();
  const projectDependencies = new Map<Node, Set<Node>>();
  const sourceValueOccurrenceKinds = new WeakMap<Node, "runtime" | "non-runtime">();
  const indexedSourceUseDeclarations = new WeakSet<Node>();
  const reservedNames = new Set<string>();
  const createNameAllocator = (): ((name: string) => string) =>
    createMojoNameAllocator([], (name) => reservedNames.add(name));
  const globalNamesBySourceFile = new WeakMap<SourceFile, (name: string) => string>();
  const unownedGlobalNames = createNameAllocator();
  const globalNames = (sourceFile: SourceFile): ((name: string) => string) => {
    const existing = globalNamesBySourceFile.get(sourceFile);
    if (existing !== undefined) return existing;
    const created = createNameAllocator();
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

  const functions: MojoAnalyzedFunction[] = [];
  const classes: MojoAnalyzedClass[] = [];
  const interfaces: MojoAnalyzedInterface[] = [];
  const enums: MojoAnalyzedEnum[] = [];
  for (const draft of drafts.functions) {
    const function_ = analyzeMojoFunctionSignature({
      source: input.source,
      providerSemantics,
      projectTypes,
      sourceProfiles,
      jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      body: draft.body,
      allocateLocalName: draft.localNames,
      bindingNames,
      bindingTypes,
      diagnostics,
    });
    if (function_ === undefined) continue;
    functions.push(function_);
    functionByDeclaration.set(draft.declaration, function_);
    for (const parameter of function_.parameters) {
      bindingSourceFiles.set(parameter.declaration, draft.sourceFile);
    }
    allocateMojoLocalBindings(
      draft.body,
      draft.localNames,
      bindingNames,
      ast,
      diagnostics,
      bindingSourceFiles,
    );
  }

  for (const draft of drafts.interfaces) {
    const analyzed = analyzeMojoInterface({
      source: input.source,
      providerSemantics,
      projectTypes,
      sourceProfiles,
      jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      stateName: draft.stateName,
      bindingNames,
      bindingTypes,
      diagnostics,
      createNameAllocator,
    });
    if (analyzed === undefined) continue;
    interfaces.push(analyzed);
    bindingTypes.set(draft.declaration, analyzed.targetType);
    if (analyzed.targetType.kind === "target-named") {
      interfaceByTypeId.set(analyzed.targetType.id, analyzed);
    }
    for (const field of analyzed.fields) {
      bindingSourceFiles.set(field.declaration, draft.sourceFile);
      fieldByDeclaration.set(field.declaration, field);
    }
  }

  for (const draft of drafts.classes) {
    const analyzed = analyzeMojoClass({
      source: input.source,
      providerSemantics,
      projectTypes,
      sourceProfiles,
      jsEnabled,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      stateName: draft.stateName,
      bindingNames,
      bindingTypes,
      diagnostics,
      createNameAllocator,
      allocateLocalBindings(body, allocate) {
        allocateMojoLocalBindings(body, allocate, bindingNames, ast, diagnostics, bindingSourceFiles);
      },
    });
    if (analyzed === undefined) continue;
    for (const field of analyzed.fields) bindingSourceFiles.set(field.declaration, draft.sourceFile);
    for (const callable of analyzed.callables) {
      bindingSourceFiles.set(callable.declaration, draft.sourceFile);
      for (const parameter of callable.parameters) {
        bindingSourceFiles.set(parameter.declaration, draft.sourceFile);
      }
    }
    classes.push(analyzed.class_);
    classByDeclaration.set(draft.declaration, analyzed.class_);
    if (analyzed.class_.targetType.kind === "target-named") {
      classByTypeId.set(analyzed.class_.targetType.id, analyzed.class_);
    }
    for (const field of analyzed.fields) fieldByDeclaration.set(field.declaration, field);
    for (const callable of analyzed.callables) {
      functions.push(callable);
      functionByDeclaration.set(callable.declaration, callable);
    }
  }

  for (const draft of drafts.enums) {
    const analyzed = analyzeMojoEnum({
      source: input.source,
      projectTypes,
      declaration: draft.declaration,
      sourceFile: draft.sourceFile,
      name: draft.name,
      allocateMemberName: createNameAllocator(),
      bindName(declaration, name) {
        bindingNames.set(declaration, name);
        bindingSourceFiles.set(declaration, draft.sourceFile);
      },
      diagnostics,
    });
    if (analyzed === undefined) continue;
    enums.push(analyzed);
    bindingTypes.set(draft.declaration, analyzed.targetType);
    for (const member of analyzed.members) {
      fieldByDeclaration.set(member.declaration, member);
      bindingTypes.set(member.declaration, analyzed.targetType);
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
    valueSelections,
    objectLiteralSelections,
    bindingPatternSelections,
    analyzeCallableExpression,
    conversions,
    functionByDeclaration,
    classByDeclaration,
    classByTypeId,
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
      const root = step.kind === "binding" ? step.binding.initializer
        : step.kind === "statement" ? step.statement
        : step.body;
      const region = analyzeMojoExecutableRegion({
        root,
        sourceFile: module.sourceFile,
        ...(step.kind === "binding" ? { rootExpectedType: step.binding.type } : {}),
        ...executableEnvironment,
      });
      recordMojoExecutableRegionConversionUses(
        root,
        undefined,
        ast,
        bindingTypes,
        expressionTypes,
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
      objectLiteralSelections,
      callableExpressionSelections,
      bindingPatternSelections,
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
    elementSelections,
    iterationSelections,
    objectLiteralSelections,
    callableExpressionSelections,
    bindingPatternSelections,
    moduleBySourceFile: finalizedModuleBySourceFile,
    moduleBindingByDeclaration,
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
    reservedNames: Object.freeze([...reservedNames].sort((left, right) => left.localeCompare(right, "en"))),
  }));
}
