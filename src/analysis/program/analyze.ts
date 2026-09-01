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
import { Node_Initializer } from "@tsonic/target-api/source";
import { createMojoNameAllocator } from "../names/allocator.js";
import {
  normalizeMojoPackageDeclarationIdentifier,
} from "../../target-model/names/identifiers.js";
import {
  analyzeAndSealMojoCallableExpression,
  resolveMojoCallableExpressionDependency,
} from "../callables/expressions.js";
import {
  classifyMojoValueConversion,
  createMojoConversionIndex,
} from "../../policy/conversions/selection.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import { createMojoProjectTypeCatalog } from "../project-types/catalog.js";
import { createMojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import {
  closeMojoErrorType,
  mergeMojoErrorTypes,
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
  MojoTemplateExpressionSelection,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { validateMojoFunctionSyntax } from "./syntax-validation.js";
import { analyzeMojoSourceModules } from "../source-modules/index.js";
import {
  analyzeMojoModuleBindings,
  finalizeMojoModuleBindingTypes,
} from "./module-bindings.js";
import {
  analyzeMojoExecutableRegion,
  sealMojoCatchBindingCarrier,
} from "./executable-regions.js";
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
import {
  closeMojoDeclarationErrorEffects,
  collectMojoEscapingErrorTypes,
} from "./error-regions.js";
import type {
  MojoAnalyzedCallArgument,
  MojoCallableArgumentSlot,
} from "./call-model.js";

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
    sourceProfiles,
    modules,
    jsEnabled,
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
    templateExpressionSelections,
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

  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection?.kind !== "callable") continue;
    const dependency = resolveMojoCallableExpressionDependency(
      selection.callee,
      input.source,
      callableExpressionSelections,
      callableExpressionByDeclaration,
    );
    if (dependency !== undefined) callDependencies.set(callNode, dependency);
  }

  const errorRegionIndexes = Object.freeze({
    source: input.source,
    expressionTypes,
    callSelections,
    callDependencies,
    propertySelections,
    elementSelections,
    resourceManagementSelections,
    valueSelections,
  });
  const effectOwners = Object.freeze([
    ...functions.map((function_) => Object.freeze({
      declaration: function_.declaration,
      roots: Object.freeze(functionEffectRoots.get(function_.declaration) ?? []),
    })),
    ...classes.filter((class_) => class_.constructors.length === 0)
      .map((class_) => Object.freeze({
        declaration: class_.declaration,
        roots: Object.freeze(classInitializationRoots.get(class_.declaration) ?? []),
      })),
    ...[...callableExpressionNodes].map((expression) => {
      const selection = callableExpressionSelections.get(expression)!;
      return Object.freeze({
        declaration: expression,
        roots: Object.freeze([
          ...selection.parameters.flatMap((parameter) => parameter.initializer === undefined
            ? []
            : [parameter.initializer]),
          selection.body,
        ]),
      });
    }),
  ]);
  const catchErrorTypes = new WeakMap<Node, MojoTargetTypeRef>();
  const sealCatchDomain = (
    catchClause: Node,
    catchBlock: Node,
    errorType: MojoTargetTypeRef | undefined,
  ): void => {
    if (errorType !== undefined) {
      catchErrorTypes.set(catchClause, errorType);
      sealMojoCatchBindingCarrier(catchClause, catchBlock, errorType, executableEnvironment);
    } else {
      catchErrorTypes.delete(catchClause);
    }
  };
  const errorClosure = closeMojoDeclarationErrorEffects(
    effectOwners,
    errorRegionIndexes,
    sealCatchDomain,
  );
  if (!errorClosure.converged) {
    diagnostics.push(diagnostic(
      "MOJO_ERROR_EFFECT_CLOSURE_DID_NOT_CONVERGE",
      "Project error effects did not reach one deterministic fixed point.",
      sourceFiles[0]!,
    ));
  }
  const errorTypesByDeclaration = errorClosure.errorTypesByDeclaration;
  const finalizedCallableTypesByDeclaration = new WeakMap<
    Node,
    Extract<MojoTargetTypeRef, { readonly kind: "callable" }>
  >();
  const sealCallableDeclaration = (
    declaration: Node,
    callableType: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>,
  ): void => {
    const existing = finalizedCallableTypesByDeclaration.get(declaration);
    if (existing !== undefined && !mojoTargetTypeEquals(existing, callableType)) {
      diagnostics.push(diagnostic(
        "MOJO_CALLABLE_DECLARATION_ERROR_DOMAIN_CONFLICT",
        "One callable declaration resolves to conflicting exact error domains.",
        declaration,
      ));
      return;
    }
    finalizedCallableTypesByDeclaration.set(declaration, callableType);
    bindingTypes.set(declaration, callableType);
    const initializer = Node_Initializer(ast, declaration);
    if (initializer === undefined) return;
    expressionTypes.set(initializer, callableType);
    const conversion = conversions.record(initializer, callableType, callableType);
    if (conversion.kind === "unsupported") {
      diagnostics.push(diagnostic("MOJO_VALUE_CONVERSION_UNPROVEN", conversion.reason, initializer));
    }
  };
  for (const expression of callableExpressionNodes) {
    const selection = callableExpressionSelections.get(expression)!;
    const errorType = closeMojoErrorType(errorTypesByDeclaration.get(expression) ?? []);
    const callableType = Object.freeze({
      ...selection.callableType,
      raises: errorType !== undefined,
      ...(errorType === undefined ? {} : { errorType }),
    });
    expressionTypes.set(expression, callableType);
    callableExpressionSelections.set(expression, Object.freeze({
      ...selection,
      raises: errorType !== undefined,
      ...(errorType === undefined ? {} : { errorType }),
      ...(selection.recursiveBinding === undefined
        ? {}
        : { recursiveBinding: Object.freeze({ ...selection.recursiveBinding, type: callableType }) }),
      callableType,
    }));
    const declaration = callableDeclarationByExpression.get(expression);
    if (declaration !== undefined) sealCallableDeclaration(declaration, callableType);
  }
  const finalizeCallableArgument = (
    argument: MojoAnalyzedCallArgument,
  ): MojoAnalyzedCallArgument => {
    const dependency = resolveMojoCallableExpressionDependency(
      argument.expression,
      input.source,
      callableExpressionSelections,
      callableExpressionByDeclaration,
    );
    const callable = dependency === undefined
      ? undefined
      : callableExpressionSelections.get(dependency);
    if (callable === undefined) return argument;
    let conversion: MojoValueConversion | undefined;
    let incompatibilityReason: string | undefined;
    if (argument.conversion.kind === "js-callback-truthiness") {
      conversion = Object.freeze({
        ...argument.conversion,
        widenRaises: !callable.callableType.raises,
      });
    } else {
      const classified = classifyMojoValueConversion(
        callable.callableType,
        argument.parameterType,
      );
      conversion = classified.kind === "resolved" ? classified.conversion : undefined;
      incompatibilityReason = classified.kind === "unsupported" ? classified.reason : undefined;
    }
    if (conversion === undefined) {
      diagnostics.push(diagnostic(
        "MOJO_CALLABLE_ARGUMENT_FINAL_CONVERSION_UNPROVEN",
        `A finalized callable argument is incompatible with its exact selected parameter carrier${
          incompatibilityReason === undefined ? "." : `: ${incompatibilityReason}`}`,
        argument.expression,
      ));
      return argument;
    }
    return Object.freeze({
      ...argument,
      sourceType: callable.callableType,
      conversion,
    });
  };
  const finalizeCallableArgumentSlot = (
    slot: MojoCallableArgumentSlot,
    replacements: ReadonlyMap<MojoAnalyzedCallArgument, MojoAnalyzedCallArgument>,
  ): MojoCallableArgumentSlot => slot.kind === "value"
    ? Object.freeze({ kind: "value", argument: replacements.get(slot.argument) ?? slot.argument })
    : slot.kind === "rest"
      ? Object.freeze({
          ...slot,
          arguments: Object.freeze(slot.arguments.map((argument) =>
            replacements.get(argument) ?? argument)),
        })
      : slot;
  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection === undefined || selection.kind === "explicit-safety" ||
      selection.kind === "native-pointer" || selection.kind === "raw-pointer" ||
      selection.kind === "typed-location") continue;
    const replacements = new Map<MojoAnalyzedCallArgument, MojoAnalyzedCallArgument>();
    const arguments_ = selection.arguments.map((argument) => {
      const finalized = finalizeCallableArgument(argument);
      replacements.set(argument, finalized);
      return finalized;
    });
    callSelections.set(callNode, Object.freeze({
      ...selection,
      arguments: Object.freeze(arguments_),
      ...(selection.kind === "callable"
        ? {
            argumentSlots: Object.freeze(selection.argumentSlots.map((slot) =>
              finalizeCallableArgumentSlot(slot, replacements))),
          }
        : {}),
    }));
  }
  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection?.kind !== "callable") continue;
    const dependency = callDependencies.get(callNode);
    if (dependency === undefined) continue;
    const callable = callableExpressionSelections.get(dependency);
    if (callable === undefined) continue;
    callSelections.set(callNode, Object.freeze({
      ...selection,
      callableType: callable.callableType,
    }));
    expressionTypes.set(selection.callee, callable.callableType);
    const reference = input.source.navigation.sourceReferenceFor(selection.callee);
    if (reference?.project === true) {
      sealCallableDeclaration(reference.declaration, callable.callableType);
    }
  }
  for (const module of analyzedModules) {
    const directErrorTypes = mergeMojoErrorTypes(...(moduleEffectRoots.get(module) ?? []).map((root) =>
      collectMojoEscapingErrorTypes(
        root,
        errorRegionIndexes,
        errorTypesByDeclaration,
        sealCatchDomain,
      )));
    moduleRegionFacts.set(module, Object.freeze({
      dependencies: new Set<Node>(),
      directErrorTypes,
    }));
  }
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
                raises: (errorTypesByDeclaration.get(alternative.disposal.dependency)?.length ?? 0) > 0,
              }),
            }))),
    }));
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
    nullishCoalescingSelections,
    elementSelections,
    iterationSelections,
    resourceManagementSelections,
    objectLiteralSelections,
    callableExpressionSelections,
    templateExpressionSelections,
    bindingPatternSelections,
    returnValueTransfers,
    moduleBySourceFile: finalizedModuleBySourceFile,
    moduleById: finalizedModuleById,
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
