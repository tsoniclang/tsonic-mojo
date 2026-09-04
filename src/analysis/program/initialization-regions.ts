import type { Node } from "@tsonic/tsts";
import { allocateMojoLocalBindings } from "./local-bindings.js";
import {
  analyzeMojoExecutableBindingProjection,
  analyzeMojoExecutableRegion,
} from "./executable-regions.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedModule,
} from "./model.js";

export function analyzeMojoProgramInitializationRegions(input: {
  readonly analyzedModules: readonly MojoAnalyzedModule[];
  readonly classes: readonly MojoAnalyzedClass[];
  readonly functions: readonly MojoAnalyzedFunction[];
  readonly environment: MojoExecutableRegionAnalysisEnvironment;
  readonly classInitializationRoots: Map<Node, Node[]>;
  readonly moduleEffectRoots: WeakMap<MojoAnalyzedModule, Node[]>;
  readonly functionEffectRoots: Map<Node, Node[]>;
  readonly createNameAllocator: () => (requested: string) => string;
}): void {
  const {
    analyzedModules,
    classes,
    functions,
    environment,
    classInitializationRoots,
    moduleEffectRoots,
    functionEffectRoots,
    createNameAllocator,
  } = input;
  const {
    source,
    bindingNames,
    bindingSourceFiles,
    bindingTypes,
    expressionTypes,
    callSelections,
    propertySelections,
    elementSelections,
    objectLiteralSelections,
    valueRefinements,
    conversions,
    diagnostics,
    analyzeCallableExpression,
  } = environment;
  const { ast } = source;

for (const module of analyzedModules) {
    for (const binding of module.bindings) {
      if (binding.disposition.kind === "direct-function") {
        expressionTypes.set(binding.disposition.expression, binding.type);
        analyzeCallableExpression(binding.disposition.expression, binding.sourceFile, undefined);
      }
    }
  }

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
        ...environment,
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

  for (const module of analyzedModules) {
    const roots: Node[] = [];
    const allocateModuleLocalName = createNameAllocator();
    for (const step of module.initializationSteps) {
      if (step.kind === "class-static-block" || step.kind === "statement") {
        allocateMojoLocalBindings(
          step.kind === "class-static-block" ? step.body : step.statement,
          allocateModuleLocalName,
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
        : step.kind === "binding-pattern" ? step.initializer
          : step.kind === "statement" ? step.statement
            : step.body;
      roots.push(root);
      analyzeMojoExecutableRegion({
        root,
        sourceFile: module.sourceFile,
        ...(step.kind === "binding" && !resourceBinding
          ? { rootExpectedType: step.binding.type }
          : step.kind === "binding-pattern"
            ? { rootExpectedType: step.sourceType }
            : {}),
        ...environment,
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
      if (step.kind === "binding-pattern") {
        analyzeMojoExecutableBindingProjection(
          step.declaration,
          step.sourceType,
          source.semantics.forFile(module.sourceFile).types.expressionType(step.initializer),
          module.sourceFile,
          environment,
        );
        const actual = expressionTypes.get(step.initializer);
        if (actual === undefined) {
          diagnostics.push(diagnostic(
            "MOJO_MODULE_PATTERN_INITIALIZER_CARRIER_NOT_CLOSED",
            "A module binding pattern initializer has no sealed Mojo carrier.",
            step.initializer,
          ));
        } else {
          const conversion = conversions.record(step.initializer, actual, step.sourceType);
          if (conversion.kind === "unsupported") {
            diagnostics.push(diagnostic(
              "MOJO_VALUE_CONVERSION_UNPROVEN",
              conversion.reason,
              step.initializer,
            ));
          }
        }
        continue;
      }
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
      const inferredBinding = ast.typeNode(step.binding.declaration) === undefined;
      const bindingType = inferredBinding ? actual : step.binding.type;
      if (inferredBinding) bindingTypes.set(step.binding.declaration, actual);
      const conversion = conversions.record(step.binding.initializer, actual, bindingType);
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
      if (parameter.bindingPatternNode === undefined) continue;
      const semantics = source.semantics.forFile(function_.sourceFile);
      const sourceType = semantics.declarations.declaredValueType(parameter.declaration) ??
        semantics.declarations.declaredType(parameter.declaration);
      analyzeMojoExecutableBindingProjection(
        parameter.declaration,
        parameter.bodyType,
        sourceType,
        function_.sourceFile,
        environment,
      );
    }
    for (const parameter of function_.parameters) {
      if (parameter.omissionKind !== "initializer" || parameter.initializer === undefined) continue;
      roots.push(parameter.initializer);
      analyzeMojoExecutableRegion({
        root: parameter.initializer,
        sourceFile: function_.sourceFile,
        rootExpectedType: parameter.bodyType,
        ...(function_.owner === undefined ? {} : { owner: function_.owner }),
        ...environment,
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
      ...environment,
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
}

