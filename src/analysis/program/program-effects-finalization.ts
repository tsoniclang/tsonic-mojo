import type { Node, SourceFile } from "@tsonic/tsts";
import { Node_Initializer } from "@tsonic/target-api/source";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import type { MojoValueConversion } from "../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { resolveMojoCallableExpressionDependency } from "../callables/expressions.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedCallArgument,
  MojoCallableArgumentSlot,
} from "./call-model.js";
import {
  closeMojoErrorType,
  mergeMojoErrorTypes,
  mojoNativeErrorType,
} from "./effects.js";
import {
  closeMojoProgramErrorEffects,
  collectMojoEscapingErrorTypes,
  directMojoNodeErrorTypes,
} from "./error-regions.js";
import {
  sealMojoCatchBindingCarrier,
} from "./executable-regions.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import type { MojoAnalyzedClass, MojoAnalyzedFunction, MojoAnalyzedModule } from "./model.js";
import type { MojoAnalyzedModuleRegionFacts } from "./module-effects.js";
import { walkSourceTree } from "./traversal.js";

export interface MojoProgramEffectsFinalizationInput {
  readonly sourceFiles: readonly SourceFile[];
  readonly environment: MojoExecutableRegionAnalysisEnvironment;
  readonly expressionErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly errorDomainIteration: number;
  readonly functions: readonly MojoAnalyzedFunction[];
  readonly classes: readonly MojoAnalyzedClass[];
  readonly analyzedModules: readonly MojoAnalyzedModule[];
  readonly functionEffectRoots: ReadonlyMap<Node, readonly Node[]>;
  readonly classInitializationRoots: ReadonlyMap<Node, readonly Node[]>;
  readonly moduleEffectRoots: WeakMap<MojoAnalyzedModule, Node[]>;
  readonly callableExpressionNodes: ReadonlySet<Node>;
  readonly callableExpressionSelections: WeakMap<Node, import("./model.js").MojoCallableExpressionSelection>;
  readonly callableExpressionByDeclaration: WeakMap<Node, Node>;
  readonly callableDeclarationByExpression: WeakMap<Node, Node>;
  readonly moduleRegionFacts: WeakMap<MojoAnalyzedModule, MojoAnalyzedModuleRegionFacts>;
}

export type MojoProgramEffectsFinalization =
  | Readonly<{
      readonly kind: "reanalyze";
      readonly sourceCallableErrorType: MojoTargetTypeRef;
    }>
  | Readonly<{
      readonly kind: "resolved";
      readonly errorTypesByDeclaration: ReadonlyMap<Node, readonly MojoTargetTypeRef[]>;
      readonly catchErrorTypes: WeakMap<Node, MojoTargetTypeRef>;
    }>;

export function finalizeMojoProgramEffects(
  input: MojoProgramEffectsFinalizationInput,
): MojoProgramEffectsFinalization {
  const {
    sourceFiles,
    environment,
    expressionErrorTypes,
    sourceCallableErrorType,
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
  } = input;
  const {
    source,
    diagnostics,
    bindingTypes,
    expressionTypes,
    callSelections,
    callNodes,
    callDependencies,
    propertySelections,
    elementSelections,
    resourceManagementSelections,
    resourceDeclarations,
    valueSelections,
    conversions,
  } = environment;
  const { ast } = source;
  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection?.kind !== "callable") continue;
    const dependency = resolveMojoCallableExpressionDependency(
      selection.callee,
      source,
      callableExpressionSelections,
      callableExpressionByDeclaration,
    );
    if (dependency !== undefined) callDependencies.set(callNode, dependency);
  }

  const errorRegionIndexes = Object.freeze({
    source,
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
      sealMojoCatchBindingCarrier(
        catchClause,
        catchBlock,
        errorType,
        environment,
      );
    } else {
      catchErrorTypes.delete(catchClause);
    }
  };
  const errorClosure = closeMojoProgramErrorEffects(
    effectOwners,
    Object.freeze([
      ...effectOwners.flatMap((owner) => owner.roots),
      ...analyzedModules.flatMap((module) => moduleEffectRoots.get(module) ?? []),
    ]),
    errorRegionIndexes,
    sealCatchDomain,
  );
  if (!errorClosure.catchDomainsConsistent) {
    diagnostics.push(diagnostic(
      "MOJO_CATCH_ERROR_DOMAIN_CONFLICT",
      "One catch clause was reached with conflicting exact Mojo error domains.",
      sourceFiles[0]!,
    ));
  }
  if (!errorClosure.converged) {
    diagnostics.push(diagnostic(
      "MOJO_ERROR_EFFECT_CLOSURE_DID_NOT_CONVERGE",
      "Project error effects did not reach one deterministic fixed point.",
      sourceFiles[0]!,
    ));
  }
  const errorTypesByDeclaration = errorClosure.errorTypesByDeclaration;
  const discoveredSourceCallableErrorType = closeMojoErrorType(mergeMojoErrorTypes(
    Object.freeze([mojoNativeErrorType()]),
    ...errorTypesByDeclaration.values(),
  ))!;
  const currentSourceCallableErrorType = sourceCallableErrorType ?? mojoNativeErrorType();
  if (!mojoTargetTypeEquals(currentSourceCallableErrorType, discoveredSourceCallableErrorType)) {
    if (errorDomainIteration >= 8) {
      diagnostics.push(diagnostic(
        "MOJO_SOURCE_CALLABLE_ERROR_DOMAIN_DID_NOT_CONVERGE",
        "Source callable error effects did not reach one deterministic compilation-wide ABI.",
        sourceFiles[0]!,
      ));
    } else {
      const nextSourceCallableErrorType = closeMojoErrorType(mergeMojoErrorTypes(
        Object.freeze([currentSourceCallableErrorType]),
        Object.freeze([discoveredSourceCallableErrorType]),
      ))!;
      return Object.freeze({
        kind: "reanalyze" as const,
        sourceCallableErrorType: nextSourceCallableErrorType,
      });
    }
  }
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
    const conversion = conversions.finalizeCallable(initializer, callableType, callableType);
    if (conversion.kind === "unsupported") {
      diagnostics.push(diagnostic("MOJO_VALUE_CONVERSION_UNPROVEN", conversion.reason, initializer));
    }
  };
  for (const expression of callableExpressionNodes) {
    const selection = callableExpressionSelections.get(expression)!;
    const exactErrorType = closeMojoErrorType(errorTypesByDeclaration.get(expression) ?? []);
    const errorType = exactErrorType === undefined
      ? undefined
      : sourceCallableErrorType ?? exactErrorType;
    const { errorType: _previousErrorType, ...baseCallableType } = selection.callableType;
    const callableType = Object.freeze({
      ...baseCallableType,
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
      source,
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
    const reference = source.navigation.sourceReferenceFor(selection.callee);
    if (reference?.project === true) {
      sealCallableDeclaration(reference.declaration, callable.callableType);
    }
  }
  for (const sourceFile of sourceFiles) {
    walkSourceTree(sourceFile, ast, (node): void => {
      const errorType = closeMojoErrorType(directMojoNodeErrorTypes(
        node,
        errorRegionIndexes,
        errorTypesByDeclaration,
      ));
      if (errorType !== undefined) expressionErrorTypes.set(node, errorType);
    });
  }
  for (const module of analyzedModules) {
    const directErrorTypes = mergeMojoErrorTypes(...(moduleEffectRoots.get(module) ?? []).map((root) =>
      collectMojoEscapingErrorTypes(
        root,
        errorRegionIndexes,
        errorTypesByDeclaration,
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
  return Object.freeze({
    kind: "resolved",
    errorTypesByDeclaration,
    catchErrorTypes,
  });
}
