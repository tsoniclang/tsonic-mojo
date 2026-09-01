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
  targetSourceSyntaxProgram,
} from "@tsonic/target-api/analysis";
import { createMojoNameAllocator } from "../names/identifiers.js";
import { analyzeMojoFunctionSignature } from "../callables/signatures.js";
import { analyzeMojoClass } from "../declarations/classes.js";
import { analyzeMojoEnum } from "../declarations/enums.js";
import { createMojoConversionIndex } from "../conversions/classification.js";
import { recordMojoFunctionConversionUses } from "../conversions/uses.js";
import { analyzeMojoRuntimePackages } from "../runtime/references.js";
import { createMojoProjectTypeCatalog } from "../types/project-catalog.js";
import {
  propagateRaisingEffects,
} from "./effects.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedDeclaration,
  MojoAnalyzedEnum,
  MojoAnalyzedFunction,
  MojoAnalyzedProjectProperty,
  MojoCallSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoPropertySelection,
  MojoProgramQueries,
  MojoTargetAnalysisRequest,
  MojoTargetProgram,
  MojoValueSelection,
} from "./model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { validateMojoFunctionSyntax } from "./syntax-validation.js";
import { analyzeMojoSourceModules } from "../modules/index.js";
import { analyzeMojoModuleBindings } from "./module-bindings.js";
import { analyzeMojoExecutableRegion } from "./executable-regions.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import { allocateMojoLocalBindings } from "./local-bindings.js";
import {
  finalizeMojoModuleEffects,
} from "./module-effects.js";
import type { MojoAnalyzedModuleRegionFacts } from "./module-effects.js";

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
  const conversions = createMojoConversionIndex();
  const functionByDeclaration = new WeakMap<Node, MojoAnalyzedFunction>();
  const classByDeclaration = new WeakMap<Node, MojoAnalyzedClass>();
  const classByTypeId = new Map<string, MojoAnalyzedClass>();
  const fieldByDeclaration = new WeakMap<Node, MojoAnalyzedProjectProperty>();
  const moduleBindingByDeclaration = new WeakMap<
    Node,
    import("./model.js").MojoAnalyzedModuleBinding
  >();
  const directRaises = new Map<Node, boolean>();
  const projectDependencies = new Map<Node, Set<Node>>();
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
  const functionDrafts: {
    readonly declaration: Node;
    readonly sourceFile: SourceFile;
    readonly name: string;
    readonly body: Node;
    readonly localNames: (sourceName: string) => string;
  }[] = [];
  const classDrafts: {
    readonly declaration: Node;
    readonly sourceFile: SourceFile;
    readonly name: string;
    readonly stateName: string;
  }[] = [];
  const enumDrafts: {
    readonly declaration: Node;
    readonly sourceFile: SourceFile;
    readonly name: string;
  }[] = [];

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
  for (const sourceFile of sourceFiles) {
    for (const statement of ast.statements(sourceFile)) {
      if (statement === undefined || ast.is.IsImportDeclaration(statement) ||
        ast.is.IsExportDeclaration(statement) || ast.is.IsTypeAliasDeclaration(statement) ||
        ast.is.IsInterfaceDeclaration(statement) || ast.is.IsVariableStatement(statement) ||
        ast.is.IsExpressionStatement(statement) || ast.is.IsExportAssignment(statement) ||
        ast.is.IsEmptyStatement(statement)) {
        continue;
      }
      if (ast.is.IsClassDeclaration(statement)) {
        const nameNode = ast.name(statement);
        if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
          diagnostics.push(diagnostic(
            "MOJO_CLASS_SHAPE_UNSUPPORTED",
            "Mojo classes require one exact named class declaration.",
            statement,
          ));
          continue;
        }
        const name = globalNameByDeclaration.get(statement) ?? globalNames(sourceFile)(ast.text(nameNode));
        bindingNames.set(statement, name);
        bindingSourceFiles.set(statement, sourceFile);
        classDrafts.push(Object.freeze({
          declaration: statement,
          sourceFile,
          name,
          stateName: globalNames(sourceFile)(`${name}State`),
        }));
        continue;
      }
      if (ast.is.IsEnumDeclaration(statement)) {
        const nameNode = ast.name(statement);
        if (nameNode === undefined || !ast.is.IsIdentifier(nameNode)) {
          diagnostics.push(diagnostic(
            "MOJO_ENUM_SHAPE_UNSUPPORTED",
            "Mojo enums require one exact named enum declaration.",
            statement,
          ));
          continue;
        }
        const name = globalNameByDeclaration.get(statement) ?? globalNames(sourceFile)(ast.text(nameNode));
        bindingNames.set(statement, name);
        bindingSourceFiles.set(statement, sourceFile);
        enumDrafts.push(Object.freeze({ declaration: statement, sourceFile, name }));
        continue;
      }
      if (!ast.is.IsFunctionDeclaration(statement)) {
        diagnostics.push(diagnostic(
          "MOJO_TOP_LEVEL_DECLARATION_UNSUPPORTED",
          "Executable project declarations require a supported top-level function or class form.",
          statement,
        ));
        continue;
      }
      const nameNode = ast.name(statement);
      const body = ast.body(statement);
      if (nameNode === undefined || !ast.is.IsIdentifier(nameNode) || body === undefined || !ast.is.IsBlock(body)) {
        diagnostics.push(diagnostic(
          "MOJO_FUNCTION_SHAPE_UNSUPPORTED",
          "Mojo functions require a named TypeScript function declaration with a body.",
          statement,
        ));
        continue;
      }
      const name = globalNameByDeclaration.get(statement) ?? globalNames(sourceFile)(ast.text(nameNode));
      bindingNames.set(statement, name);
      bindingSourceFiles.set(statement, sourceFile);
      functionDrafts.push(Object.freeze({
        declaration: statement,
        sourceFile,
        name,
        body,
        localNames: createNameAllocator(),
      }));
    }
  }

  const functions: MojoAnalyzedFunction[] = [];
  const classes: MojoAnalyzedClass[] = [];
  const enums: MojoAnalyzedEnum[] = [];
  for (const draft of functionDrafts) {
    const function_ = analyzeMojoFunctionSignature({
      source: input.source,
      providerSemantics,
      projectTypes,
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

  for (const draft of classDrafts) {
    const analyzed = analyzeMojoClass({
      source: input.source,
      providerSemantics,
      projectTypes,
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

  for (const draft of enumDrafts) {
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

  const executableEnvironment: MojoExecutableRegionAnalysisEnvironment = {
    source: input.source,
    providerSemantics,
    projectTypes,
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
    conversions,
    functionByDeclaration,
    classByDeclaration,
    classByTypeId,
    fieldByDeclaration,
  };

  for (const class_ of classes) {
    for (const field of class_.fields) {
      analyzeMojoExecutableRegion({
        root: field.initializer,
        sourceFile: class_.sourceFile,
        owner: Object.freeze({ name: class_.name, stateName: class_.stateName, type: class_.targetType }),
        ...executableEnvironment,
      });
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
        ...executableEnvironment,
      });
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
      ...(function_.owner === undefined ? {} : { owner: function_.owner }),
      ...executableEnvironment,
    });
    projectDependencies.set(function_.declaration, new Set(region.dependencies));
    recordMojoFunctionConversionUses(
      function_,
      ast,
      bindingTypes,
      expressionTypes,
      propertySelections,
      elementSelections,
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
      bindingNames,
      diagnostics,
    );
  }
  if (diagnostics.length > 0) return rejectedTargetStage(diagnostics);

  const queries: MojoProgramQueries = Object.freeze({
    bindingName(referenceOrDeclaration: Node): string | undefined {
      return bindingNames.get(referenceOrDeclaration);
    },
    bindingSourceFile(referenceOrDeclaration: Node): SourceFile | undefined {
      return bindingSourceFiles.get(referenceOrDeclaration);
    },
    bindingType(declaration: Node): MojoTargetTypeRef | undefined {
      return bindingTypes.get(declaration);
    },
    expressionType(expression: Node): MojoTargetTypeRef | undefined {
      return expressionTypes.get(expression);
    },
    expressionConversion(expression: Node, expectedType: MojoTargetTypeRef) {
      return conversions.get(expression, expectedType);
    },
    callSelection(call: Node): MojoCallSelection | undefined {
      return callSelections.get(call);
    },
    propertySelection(access: Node): MojoPropertySelection | undefined {
      return propertySelections.get(access);
    },
    valueSelection(expression: Node): MojoValueSelection | undefined {
      return valueSelections.get(expression);
    },
    elementSelection(access: Node): MojoElementSelection | undefined {
      return elementSelections.get(access);
    },
    iterationSelection(statement: Node): MojoIterationSelection | undefined {
      return iterationSelections.get(statement);
    },
    moduleForSourceFile(sourceFile: SourceFile) {
      return finalizedModuleBySourceFile.get(sourceFile);
    },
    moduleBinding(referenceOrDeclaration: Node) {
      const direct = moduleBindingByDeclaration.get(referenceOrDeclaration);
      if (direct !== undefined) return direct;
      const reference = input.source.navigation.sourceReferenceFor(referenceOrDeclaration);
      return reference === undefined ? undefined : moduleBindingByDeclaration.get(reference.declaration);
    },
  });
  const topLevelFunctions = finalizedFunctions.filter((function_) => function_.kind === "function");
  const declarations: MojoAnalyzedDeclaration[] = [
    ...topLevelFunctions,
    ...finalizedClasses,
    ...enums,
  ];
  return resolvedTargetStage(Object.freeze({
    configuration,
    source: targetSourceSyntaxProgram(input.source),
    projectTypes,
    modules,
    analyzedModules: finalizedModules,
    declarations: Object.freeze(declarations),
    queries,
    runtimePackages: analyzeMojoRuntimePackages(input.runtimeReferences),
    reservedNames: Object.freeze([...reservedNames].sort((left, right) => left.localeCompare(right, "en"))),
  }));
}
