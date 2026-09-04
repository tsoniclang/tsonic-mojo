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
  collectMojoEvaluationErrorTypes,
  collectMojoEscapingErrorTypes,
} from "./error-regions.js";
import {
  sealMojoCatchBindingCarrier,
} from "./executable-regions.js";
import type { MojoExecutableRegionAnalysisEnvironment } from "./executable-regions.js";
import type { MojoAnalyzedClass, MojoAnalyzedFunction, MojoAnalyzedModule } from "./model.js";
import type { MojoAnalyzedModuleRegionFacts } from "./module-effects.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";

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
    propertyNodes,
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
  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection?.kind !== "provider" ||
      selection.propagatedCallbackParameterIndex === undefined) continue;
    const callbackArguments = selection.arguments.filter((argument) =>
      argument.parameterIndex === selection.propagatedCallbackParameterIndex);
    if (callbackArguments.length !== 1) continue;
    const dependency = resolveMojoCallableExpressionDependency(
      callbackArguments[0]!.expression,
      source,
      callableExpressionSelections,
      callableExpressionByDeclaration,
    );
    if (dependency !== undefined) callDependencies.set(callNode, dependency);
  }

  const dynamicMethodErrors = new Map<Node, MojoTargetTypeRef[]>();
  for (const propertyNode of propertyNodes) {
    const selection = propertySelections.get(propertyNode);
    if (selection?.kind !== "project-method" ||
      (selection.accessMode !== "write" && selection.accessMode !== "read-write") ||
      !selection.callableType.raises) continue;
    const errorType = selection.callableType.errorType ?? mojoNativeErrorType();
    const current = dynamicMethodErrors.get(selection.declaration) ?? [];
    if (!current.some((candidate) => mojoTargetTypeEquals(candidate, errorType))) {
      current.push(errorType);
    }
    dynamicMethodErrors.set(selection.declaration, current);
  }
  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection?.kind !== "project" || selection.target.kind !== "method") continue;
    const dynamicDispatchErrorType = closeMojoErrorType(Object.freeze(
      dynamicMethodErrors.get(selection.target.declaration) ?? [],
    ));
    if (dynamicDispatchErrorType !== undefined) {
      callSelections.set(callNode, Object.freeze({ ...selection, dynamicDispatchErrorType }));
    }
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
    const errorType = exactErrorType;
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
  for (const sourceFile of sourceFiles) {
    walkSourceTree(sourceFile, ast, (node): void => {
      const initializer = Node_Initializer(ast, node);
      if (initializer === undefined) return;
      const dependency = resolveMojoCallableExpressionDependency(
        initializer,
        source,
        callableExpressionSelections,
        callableExpressionByDeclaration,
      );
      const callable = dependency === undefined
        ? undefined
        : callableExpressionSelections.get(dependency);
      if (callable !== undefined) sealCallableDeclaration(node, callable.callableType);
    });
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
      conversion = argument.conversion;
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
  const finalizePropagatedCallback = (
    selection: Extract<import("./call-model.js").MojoCallSelection, { readonly kind: "provider" }>,
    arguments_: readonly MojoAnalyzedCallArgument[],
  ): Extract<import("./call-model.js").MojoCallSelection, { readonly kind: "provider" }> => {
    const parameterIndex = selection.propagatedCallbackParameterIndex;
    if (parameterIndex === undefined) return Object.freeze({ ...selection, arguments: arguments_ });
    const matches = arguments_.filter((argument) => argument.parameterIndex === parameterIndex);
    const argument = matches.length === 1 ? matches[0] : undefined;
    if (argument?.sourceType.kind !== "callable" || argument.parameterType.kind !== "callable") {
      diagnostics.push(diagnostic(
        "MOJO_PROPAGATED_CALLBACK_FINALIZATION_UNPROVEN",
        "A callback-propagating operation requires one exact finalized callable argument.",
        argument?.expression ?? selection.arguments[0]?.expression ?? sourceFiles[0]!,
      ));
      return Object.freeze({ ...selection, arguments: arguments_ });
    }
    const callbackErrorType = argument.sourceType.raises
      ? argument.sourceType.errorType ?? mojoNativeErrorType()
      : mojoNativeErrorType();
    const targetType = Object.freeze({
      ...argument.parameterType,
      raises: true,
      errorType: callbackErrorType,
    });
    const classified = argument.conversion.kind === "js-callback-truthiness"
      ? undefined
      : classifyMojoValueConversion(argument.sourceType, targetType);
    const conversion = argument.conversion.kind === "js-callback-truthiness"
      ? Object.freeze({
          ...argument.conversion,
          targetType,
        })
      : classified?.kind === "resolved"
        ? classified.conversion
        : undefined;
    if (conversion === undefined) {
      diagnostics.push(diagnostic(
        "MOJO_PROPAGATED_CALLBACK_CONVERSION_UNPROVEN",
        "A callback-propagating operation cannot align its finalized callable with the native helper ABI.",
        argument.expression,
      ));
      return Object.freeze({ ...selection, arguments: arguments_ });
    }
    const finalizedArgument = Object.freeze({
      ...argument,
      parameterType: targetType,
      conversion,
    });
    const finalizedArguments = Object.freeze(arguments_.map((entry) =>
      entry === argument ? finalizedArgument : entry));
    const parameterTypes = Object.freeze(selection.operation.parameterTypes.map((type, index) =>
      index === parameterIndex ? targetType : type));
    const operationErrorType = closeMojoErrorType([
      ...(selection.propagatedCallbackBaseErrorType === undefined
        ? []
        : [selection.propagatedCallbackBaseErrorType]),
      callbackErrorType,
    ]);
    return Object.freeze({
      ...selection,
      operation: Object.freeze({
        ...selection.operation,
        parameterTypes,
        raises: operationErrorType !== undefined,
        ...(operationErrorType === undefined ? {} : { errorType: operationErrorType }),
      }),
      arguments: finalizedArguments,
    });
  };
  for (const callNode of callNodes) {
    const selection = callSelections.get(callNode);
    if (selection === undefined || selection.kind === "explicit-safety" ||
      selection.kind === "native-pointer" || selection.kind === "raw-pointer" ||
      selection.kind === "typed-location" || selection.kind === "source-intrinsic") continue;
    const replacements = new Map<MojoAnalyzedCallArgument, MojoAnalyzedCallArgument>();
    const arguments_ = selection.arguments.map((argument) => {
      const finalized = finalizeCallableArgument(argument);
      replacements.set(argument, finalized);
      return finalized;
    });
    const finalizedArguments = Object.freeze(arguments_);
    callSelections.set(callNode, selection.kind === "provider"
      ? finalizePropagatedCallback(selection, finalizedArguments)
      : Object.freeze({
          ...selection,
          arguments: finalizedArguments,
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
  const evaluationErrorTypeCache = new WeakMap<Node, readonly MojoTargetTypeRef[]>();
  for (const sourceFile of sourceFiles) {
    walkSourceTree(sourceFile, ast, (node): void => {
      const errorType = closeMojoErrorType(collectMojoEvaluationErrorTypes(
        node,
        errorRegionIndexes,
        errorTypesByDeclaration,
        evaluationErrorTypeCache,
      ));
      if (errorType === undefined) expressionErrorTypes.delete(node);
      else expressionErrorTypes.set(node, errorType);
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
