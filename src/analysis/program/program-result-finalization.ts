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
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
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
import { mojoParameterConvention } from "../representations/index.js";
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

function selectMojoBinaryEntry(
  outputType: "bin" | "lib",
  modules: MojoSourceModuleCatalog,
  functions: readonly import("./model.js").MojoAnalyzedTopLevelFunction[],
  navigation: MojoTargetAnalysisRequest["input"]["source"]["navigation"],
  diagnostics: TargetDiagnostic[],
): import("./model.js").MojoAnalyzedTopLevelFunction | undefined {
  if (outputType !== "bin") return undefined;
  const exported = modules.entryPoint.exports.filter(({ exportName }) => exportName === "main");
  const candidates = [...new Set(exported.flatMap((entry) => {
    const selected = navigation.callableImplementation(entry.declaration);
    const declaration = selected.kind === "resolved"
      ? selected.implementation.declaration
      : entry.declaration;
    return functions.filter((function_) => function_.declaration === declaration);
  }))];
  const selected = candidates.length === 1 ? candidates[0] : undefined;
  if (selected === undefined || selected.parameters.length !== 0 ||
    selected.typeParameters.length !== 0 || selected.resultType.kind !== "unit") {
    diagnostics.push(diagnostic(
      "MOJO_BINARY_ENTRYPOINT_UNSUPPORTED",
      "Binary output requires the configured entry module to export exactly one non-generic 'main' function with no parameters and a void result.",
      modules.entryPoint.sourceFile,
    ));
    return undefined;
  }
  return selected;
}

function addMojoFirstClassFunctionBindings(
  modules: readonly MojoAnalyzedModule[],
  contracts: readonly import("./model.js").MojoAnalyzedCallableSignature[],
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
  source: MojoTargetAnalysisRequest["input"]["source"],
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  bindingTypes: WeakMap<Node, MojoTargetTypeRef>,
  conversions: import("../../policy/conversions/selection.js").MojoConversionIndex,
  relationships: import("../../target-model/types/project.js").MojoProjectTypeRelationships,
  diagnostics: TargetDiagnostic[],
): readonly MojoAnalyzedModule[] {
  const contractGroups = new Map<Node, {
    readonly implementation: MojoAnalyzedFunction;
    readonly contracts: import("./model.js").MojoAnalyzedCallableSignature[];
  }>();
  for (const contract of contracts) {
    const selected = source.navigation.callableImplementation(contract.declaration);
    const implementation = selected.kind === "resolved"
      ? implementations.get(selected.implementation.declaration)
      : implementations.get(contract.declaration);
    if (implementation === undefined || implementation.kind !== "function") continue;
    const group = contractGroups.get(implementation.declaration) ?? {
      implementation,
      contracts: [],
    };
    group.contracts.push(contract);
    contractGroups.set(implementation.declaration, group);
  }
  const uses = new Map<Node, ReturnType<
    MojoTargetAnalysisRequest["input"]["source"]["navigation"]["declarationUseSummary"]
  >["uses"][number]>();
  for (const contract of contracts) {
    for (const use of source.navigation.declarationUseSummary(contract.declaration).uses) {
      if (use.kind === "first-class" && !isCallableDeclarationName(use.reference, source)) {
        uses.set(use.reference, use);
      }
    }
  }
  const bindingsBySourceFile = new Map<SourceFile, Map<Node, {
    readonly target: import("./model.js").MojoAnalyzedCallableSignature;
    readonly type: Extract<MojoTargetTypeRef, { readonly kind: "callable" }>;
    readonly references: Node[];
  }>>();
  for (const use of uses.values()) {
    const reference = source.navigation.sourceReferenceFor(use.reference);
    const selected = reference === undefined
      ? undefined
      : source.navigation.callableImplementation(reference.declaration);
    const group = selected?.kind === "resolved"
      ? contractGroups.get(selected.implementation.declaration)
      : undefined;
    const expected = expressionTypes.get(use.reference);
    if (group === undefined || expected?.kind !== "callable") {
      diagnostics.push(diagnostic(
        "MOJO_FIRST_CLASS_FUNCTION_CARRIER_UNRESOLVED",
        "A first-class project function reference requires one exact implementation group and callable carrier.",
        use.reference,
      ));
      continue;
    }
    const candidates = group.contracts.flatMap((contract) => {
      const target = functionValueTarget(contract, group.implementation);
      if (target === undefined) return [];
      const type = functionValueCallableType(target, group.implementation);
      const conversion = classifyMojoValueConversion(type, expected, undefined, relationships);
      return conversion.kind === "resolved"
        ? [Object.freeze({ target, type, conversion: conversion.conversion })]
        : [];
    });
    const exact = candidates.filter((candidate) => mojoTargetTypeEquals(candidate.type, expected));
    const selectedCandidates = exact.length > 0 ? exact : candidates;
    const unique = selectedCandidates.filter((candidate, index, all) =>
      all.findIndex((other) => mojoTargetTypeEquals(other.type, candidate.type) &&
        other.target.name === candidate.target.name) === index);
    const candidate = unique.length === 1 ? unique[0] : undefined;
    if (candidate === undefined) {
      diagnostics.push(diagnostic(
        unique.length === 0
          ? "MOJO_FIRST_CLASS_FUNCTION_ABI_UNSUPPORTED"
          : "MOJO_FIRST_CLASS_FUNCTION_OVERLOAD_AMBIGUOUS",
        unique.length === 0
          ? "No exact project function overload can satisfy the selected first-class callable ABI."
          : "More than one project function overload can satisfy the selected first-class callable ABI.",
        use.reference,
      ));
      continue;
    }
    const finalized = conversions.finalizeCallable(use.reference, candidate.type, expected);
    if (finalized.kind === "unsupported") {
      diagnostics.push(diagnostic(
        "MOJO_FIRST_CLASS_FUNCTION_CONVERSION_UNPROVEN",
        finalized.reason,
        use.reference,
      ));
      continue;
    }
    expressionTypes.set(use.reference, candidate.type);
    bindingTypes.set(use.reference, candidate.type);
    const ownerBindings = bindingsBySourceFile.get(group.implementation.sourceFile) ?? new Map();
    const existing = ownerBindings.get(candidate.target.declaration);
    if (existing === undefined) {
      ownerBindings.set(candidate.target.declaration, {
        target: candidate.target,
        type: candidate.type,
        references: [use.reference],
      });
    } else {
      existing.references.push(use.reference);
    }
    bindingsBySourceFile.set(group.implementation.sourceFile, ownerBindings);
  }
  return Object.freeze(modules.map((module) => {
    const selectedFunctions = [...(bindingsBySourceFile.get(module.sourceFile)?.values() ?? [])];
    if (selectedFunctions.length === 0) return module;
    const occupiedNames = new Set(module.bindings.map((binding) => binding.name));
    const bindings = [...module.bindings];
    const functionValueSteps: import("./model.js").MojoModuleInitializationStep[] = [];
    for (const selected of selectedFunctions) {
      const function_ = selected.target;
      const name = allocateFunctionValueName(occupiedNames, `${function_.name}_value`);
      const sourceNameNode = source.ast.name(function_.declaration);
      const binding = Object.freeze({
        kind: "function-value" as const,
        declaration: selected.references[0]!,
        sourceFile: function_.sourceFile,
        sourceName: sourceNameNode === undefined ? function_.name : source.ast.text(sourceNameNode),
        name,
        declarationKind: "const" as const,
        disposition: Object.freeze({ kind: "immutable-runtime" as const }),
        type: selected.type,
        initializer: selected.references[0]!,
        functionValue: function_,
        references: Object.freeze(selected.references),
      }) satisfies MojoAnalyzedModuleBinding;
      bindings.push(binding);
      functionValueSteps.push(Object.freeze({ kind: "binding" as const, binding }));
    }
    if (bindings.length === module.bindings.length) return module;
    return Object.freeze({
      ...module,
      bindings: Object.freeze(bindings),
      initializationSteps: Object.freeze([
        ...functionValueSteps,
        ...module.initializationSteps,
      ]),
      directRuntimeInitializationRequired: true,
      initializationStateRequired: true,
      runtimeInitializationRequired: true,
    });
  }));
}

function functionValueTarget(
  contract: import("./model.js").MojoAnalyzedCallableSignature,
  implementation: MojoAnalyzedFunction,
): import("./model.js").MojoAnalyzedCallableSignature | undefined {
  if (contract.asynchronous || contract.typeParameters.length !== 0 ||
    contract.parameters.some((parameter) => {
      const convention = mojoParameterConvention(parameter.disposition);
      return convention !== "imm" && convention !== "var";
    })) return undefined;
  if (contract.declaration === implementation.declaration) return implementation;
  return contract.implementationAdapterName === undefined
    ? undefined
    : Object.freeze({
        ...contract,
        name: contract.implementationAdapterName,
        raises: implementation.raises,
        ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
      });
}

function functionValueCallableType(
  target: import("./model.js").MojoAnalyzedCallableSignature,
  implementation: MojoAnalyzedFunction,
): Extract<MojoTargetTypeRef, { readonly kind: "callable" }> {
  return Object.freeze({
    kind: "callable",
    parameters: Object.freeze(target.parameters.map((parameter) => Object.freeze({
      name: parameter.name,
      convention: mojoParameterConvention(parameter.disposition),
      passing: parameter.disposition.kind === "owned" ? "consume" as const : "plain" as const,
      type: parameter.callType,
      omissionKind: parameter.omissionKind,
    }))),
    result: target.resultType,
    raises: implementation.raises,
    ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
  });
}

function isCallableDeclarationName(
  reference: Node,
  source: MojoTargetAnalysisRequest["input"]["source"],
): boolean {
  const parent = source.ast.parent(reference);
  return parent !== undefined && source.ast.name(parent) === reference &&
    (source.ast.is.IsFunctionDeclaration(parent) ||
      source.ast.is.IsMethodDeclaration(parent) ||
      source.ast.is.IsConstructorDeclaration(parent));
}

function allocateFunctionValueName(occupied: Set<string>, requested: string): string {
  let candidate = requested;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${requested}_${suffix}`;
    suffix += 1;
  }
  occupied.add(candidate);
  return candidate;
}
