import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { Node_Expression, Node_Initializer } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { analyzeMojoFunctionSignature } from "./signatures.js";
import type {
  MojoAnalyzedClassOwner,
  MojoAnalyzedFunction,
  MojoCallableCapture,
  MojoCallableExpressionSelection,
  MojoRecursiveCallableBinding,
} from "../program/model.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";
import {
  analyzeMojoExecutableRegion,
} from "../program/executable-regions.js";
import type {
  MojoExecutableRegionAnalysisEnvironment,
} from "../program/executable-regions.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";
import { allocateMojoLocalBindings } from "../program/local-bindings.js";
import type { MojoLifecycleResolver } from "../lifecycle/model.js";

export interface MojoCallableExpressionSignatureInput {
  readonly expression: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly lifecycle: MojoLifecycleResolver;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly allocateLocalName: (sourceName: string) => string;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly diagnostics: TargetDiagnostic[];
}

export function analyzeMojoCallableExpressionSignature(
  input: MojoCallableExpressionSignatureInput,
): MojoAnalyzedFunction | undefined {
  const { ast } = input.source;
  const semantics = input.source.semantics.forFile(input.sourceFile);
  const selectedType = semantics.types.expressionType(input.expression);
  const callableEvidence = selectedType === undefined
    ? undefined
    : semantics.types.callable(selectedType);
  const body = ast.body(input.expression);
  if (body === undefined) {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_CALLABLE_EXPRESSION_BODY_MISSING",
      "A callable expression requires one exact authored body.",
      input.expression,
    ));
    return undefined;
  }
  const callable = analyzeMojoFunctionSignature({
    source: input.source,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    lifecycle: input.lifecycle,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    ...(input.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: input.sourceCallableErrorType }),
    declaration: input.expression,
    sourceFile: input.sourceFile,
    name: "",
    body,
    allocateLocalName: input.allocateLocalName,
    bindingNames: input.bindingNames,
    bindingTypes: input.bindingTypes,
    diagnostics: input.diagnostics,
    ...(callableEvidence === undefined ? {} : { callable: callableEvidence }),
    ...(input.owner === undefined ? {} : { owner: input.owner }),
  });
  if (callable === undefined) return undefined;
  if (callable.asynchronous) {
    input.diagnostics.push(mojoAnalysisDiagnostic(
      "MOJO_ASYNC_CALLABLE_EXPRESSION_NATIVE_LIMIT",
      "The pinned Mojo lambda syntax has no native asynchronous lambda form.",
      input.expression,
    ));
    return undefined;
  }
  for (const parameter of callable.parameters) {
    input.bindingSourceFiles.set(parameter.declaration, input.sourceFile);
  }
  allocateMojoLocalBindings(
    body,
    input.allocateLocalName,
    input.bindingNames,
    ast,
    input.diagnostics,
    input.bindingSourceFiles,
  );
  return callable;
}

export interface MojoCallableCaptureInput {
  readonly expression: Node;
  readonly roots: readonly Node[];
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly source: TargetSourceProgram;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly ensureLocationStorage: (declaration: Node, bindingName: string) => string;
  readonly moduleBindingByDeclaration: WeakMap<Node, unknown>;
  readonly diagnostics: TargetDiagnostic[];
  readonly recursiveDeclaration?: Node;
}

export function collectMojoCallableCaptures(
  input: MojoCallableCaptureInput,
): {
  readonly captures: readonly MojoCallableCapture[];
  readonly recursiveBinding?: MojoRecursiveCallableBinding;
} | undefined {
  const { ast } = input.source;
  const captures = new Map<Node, MojoCallableCapture>();
  let recursiveBinding: MojoRecursiveCallableBinding | undefined;
  let valid = true;
  let capturesSelf = false;
  for (const root of input.roots) {
    walkSourceTree(root, ast, (node): void => {
      if (!valid) return;
      if (ast.kindName(node) === "KindThisKeyword") {
        capturesSelf = input.owner !== undefined;
        return;
      }
      if (!ast.is.IsIdentifier(node)) return;
      const expressionType = input.expressionTypes.get(node);
      if (expressionType?.kind === "undefined" || expressionType?.kind === "null") return;
      const reference = input.source.navigation.sourceReferenceFor(node);
      if (reference?.project !== true) return;
      const declaration = reference?.declaration;
      if (declaration === undefined || nodeIsWithin(declaration, input.expression, ast) ||
        input.moduleBindingByDeclaration.has(declaration) || captures.has(declaration)) return;
      if (!captureEligibleDeclaration(declaration, ast)) return;
      const bindingName = input.bindingNames.get(declaration);
      const symbol = reference?.symbol;
      const type = input.bindingTypes.get(declaration);
      if (bindingName === undefined || symbol === undefined || type === undefined) {
        input.diagnostics.push(mojoAnalysisDiagnostic(
          "MOJO_CALLABLE_CAPTURE_IDENTITY_MISSING",
          "A captured source binding requires one exact declaration, symbol, target name, and carrier.",
          node,
        ));
        valid = false;
        return;
      }
      if (declaration === input.recursiveDeclaration) {
        if (type.kind !== "callable") {
          input.diagnostics.push(mojoAnalysisDiagnostic(
            "MOJO_RECURSIVE_CALLABLE_CARRIER_NOT_CLOSED",
            "A recursive callable binding requires one exact callable carrier.",
            node,
          ));
          valid = false;
          return;
        }
        recursiveBinding = Object.freeze({ declaration, name: bindingName, type });
        return;
      }
      const mutated = input.source.navigation.bindingWritesWithin(symbol, input.sourceFile).length > 0;
      const existingLocation = input.locationStorageNames.get(declaration);
      const storage = existingLocation !== undefined || mutated ? "location" : "value";
      const name = storage === "location"
        ? existingLocation ?? input.ensureLocationStorage(declaration, bindingName)
        : bindingName;
      captures.set(declaration, Object.freeze({
        declaration,
        name,
        type,
        storage,
      }));
    }, (node, traversalRoot) => node === traversalRoot || !isNestedCallable(node, ast));
  }
  if (!valid) return undefined;
  const ordered = [...captures.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "en"));
  if (capturesSelf) {
    ordered.unshift(Object.freeze({
      declaration: input.expression,
      name: "self",
      type: input.owner!.type,
      storage: "value",
    }));
  }
  return Object.freeze({
    captures: Object.freeze(ordered),
    ...(recursiveBinding === undefined ? {} : { recursiveBinding }),
  });
}

export interface MojoCallableExpressionAnalysisInput {
  readonly expression: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly allocateLocalName: (sourceName: string) => string;
  readonly moduleBindingByDeclaration: WeakMap<Node, unknown>;
  readonly ensureLocationStorage: (declaration: Node, bindingName: string) => string;
  readonly selections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly byDeclaration: WeakMap<Node, Node>;
  readonly declarationByExpression: WeakMap<Node, Node>;
  readonly analyzed: WeakSet<Node>;
  readonly environment: MojoExecutableRegionAnalysisEnvironment;
}

export function analyzeAndSealMojoCallableExpression(
  input: MojoCallableExpressionAnalysisInput,
): void {
  if (input.analyzed.has(input.expression)) return;
  input.analyzed.add(input.expression);
  const environment = input.environment;
  const callable = analyzeMojoCallableExpressionSignature({
    expression: input.expression,
    sourceFile: input.sourceFile,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    source: environment.source,
    providerSemantics: environment.providerSemantics,
    projectTypes: environment.projectTypes,
    lifecycle: environment.lifecycle,
    sourceProfiles: environment.sourceProfiles,
    jsEnabled: environment.jsEnabled,
    allocateLocalName: input.allocateLocalName,
    bindingNames: environment.bindingNames,
    bindingTypes: environment.bindingTypes,
    bindingSourceFiles: environment.bindingSourceFiles,
    diagnostics: environment.diagnostics,
    ...(environment.sourceCallableErrorType === undefined
      ? {}
      : { sourceCallableErrorType: environment.sourceCallableErrorType }),
  });
  if (callable === undefined) return;
  let raises = false;
  const initializerRoots: Node[] = [];
  for (const parameter of callable.parameters) {
    if (parameter.omissionKind !== "initializer" || parameter.initializer === undefined) continue;
    initializerRoots.push(parameter.initializer);
    const initializerRegion = analyzeMojoExecutableRegion({
      root: parameter.initializer,
      sourceFile: input.sourceFile,
      rootExpectedType: parameter.bodyType,
      ...(input.owner === undefined ? {} : { owner: input.owner }),
      ...environment,
    });
    recordMojoExecutableRegionConversionUses(
      parameter.initializer,
      undefined,
      environment.source.ast,
      environment.bindingTypes,
      environment.expressionTypes,
      environment.callSelections,
      environment.propertySelections,
      environment.elementSelections,
      environment.objectLiteralSelections,
      environment.valueRefinements,
      environment.conversions,
      environment.diagnostics,
    );
    const actual = environment.expressionTypes.get(parameter.initializer);
    if (actual === undefined) {
      environment.diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_DEFAULT_PARAMETER_INITIALIZER_CARRIER_NOT_CLOSED",
        "A default parameter initializer requires one exact sealed Mojo carrier.",
        parameter.initializer,
      ));
    } else {
      const conversion = environment.conversions.record(
        parameter.initializer,
        actual,
        parameter.bodyType,
      );
      if (conversion.kind === "unsupported") {
        environment.diagnostics.push(mojoAnalysisDiagnostic(
          "MOJO_VALUE_CONVERSION_UNPROVEN",
          conversion.reason,
          parameter.initializer,
        ));
      }
    }
    raises = raises || initializerRegion.raises;
  }
  const region = analyzeMojoExecutableRegion({
    root: callable.body,
    sourceFile: input.sourceFile,
    rootExpectedType: callable.resultType,
    returnType: callable.resultType,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...environment,
  });
  raises = raises || region.raises;
  if (environment.source.ast.is.IsBlock(callable.body)) {
    recordMojoExecutableRegionConversionUses(
      callable.body,
      callable.resultType,
      environment.source.ast,
      environment.bindingTypes,
      environment.expressionTypes,
      environment.callSelections,
      environment.propertySelections,
      environment.elementSelections,
      environment.objectLiteralSelections,
      environment.valueRefinements,
      environment.conversions,
      environment.diagnostics,
    );
  } else {
    recordMojoExecutableRegionConversionUses(
      callable.body,
      callable.resultType,
      environment.source.ast,
      environment.bindingTypes,
      environment.expressionTypes,
      environment.callSelections,
      environment.propertySelections,
      environment.elementSelections,
      environment.objectLiteralSelections,
      environment.valueRefinements,
      environment.conversions,
      environment.diagnostics,
    );
    const actualBodyType = environment.expressionTypes.get(callable.body);
    if (actualBodyType === undefined) {
      environment.diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_CALLABLE_RESULT_CARRIER_NOT_CLOSED",
        "A callable expression body has no exact sealed result carrier.",
        callable.body,
      ));
      return;
    }
    const resultConversion = environment.conversions.record(
      callable.body,
      actualBodyType,
      callable.resultType,
    );
    if (resultConversion.kind === "unsupported") {
      environment.diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_VALUE_CONVERSION_UNPROVEN",
        resultConversion.reason,
        callable.body,
      ));
      return;
    }
  }
  const declaration = callableExpressionDeclaration(input.expression, environment.source);
  const captureAnalysis = collectMojoCallableCaptures({
    expression: input.expression,
    roots: Object.freeze([...initializerRoots, callable.body]),
    sourceFile: input.sourceFile,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    source: environment.source,
    bindingNames: environment.bindingNames,
    bindingTypes: environment.bindingTypes,
    expressionTypes: environment.expressionTypes,
    locationStorageNames: environment.locationStorageNames,
    ensureLocationStorage: input.ensureLocationStorage,
    moduleBindingByDeclaration: input.moduleBindingByDeclaration,
    diagnostics: environment.diagnostics,
    ...(declaration === undefined ? {} : { recursiveDeclaration: declaration }),
  });
  const selectedType = environment.expressionTypes.get(input.expression);
  if (captureAnalysis === undefined || selectedType?.kind !== "callable" ||
    selectedType.parameters.length !== callable.parameters.length) {
    if (captureAnalysis !== undefined) {
      environment.diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_CALLABLE_EXPRESSION_CARRIER_NOT_CLOSED",
        "A callable expression requires one exact function carrier aligned with its authored parameters.",
        input.expression,
      ));
    }
    return;
  }
  const { errorType: _selectedErrorType, ...selectedCallableType } = selectedType;
  const callableType = Object.freeze({
    ...selectedCallableType,
    result: callable.resultType,
    raises,
    ...(raises && environment.sourceCallableErrorType !== undefined
      ? { errorType: environment.sourceCallableErrorType }
      : {}),
  });
  environment.expressionTypes.set(input.expression, callableType);
  input.selections.set(input.expression, Object.freeze({
    expression: input.expression,
    parameters: callable.parameters,
    captures: captureAnalysis.captures,
    ...(captureAnalysis.recursiveBinding === undefined
      ? {}
      : { recursiveBinding: captureAnalysis.recursiveBinding }),
    resultType: callable.resultType,
    body: callable.body,
    raises,
    callableType,
  }));
  if (declaration !== undefined) {
    input.byDeclaration.set(declaration, input.expression);
    input.declarationByExpression.set(input.expression, declaration);
  }
}

export function resolveMojoCallableExpressionDependency(
  expression: Node,
  source: TargetSourceProgram,
  selections: WeakMap<Node, MojoCallableExpressionSelection>,
  byDeclaration: WeakMap<Node, Node>,
): Node | undefined {
  const visitedDeclarations = new Set<Node>();
  let current: Node | undefined = expression;
  while (current !== undefined) {
    current = unwrapCallableExpression(current, source);
    if (selections.has(current)) return current;
    const reference = source.navigation.sourceReferenceFor(current);
    if (reference?.project !== true || visitedDeclarations.has(reference.declaration)) {
      return undefined;
    }
    const symbol = reference.symbol;
    if (symbol === undefined || source.sourceFiles.some((sourceFile) => sourceFile !== undefined &&
      source.navigation.bindingWritesWithin(symbol, sourceFile).length > 0)) {
      return undefined;
    }
    visitedDeclarations.add(reference.declaration);
    const direct = byDeclaration.get(reference.declaration);
    if (direct !== undefined) return direct;
    current = Node_Initializer(source.ast, reference.declaration);
  }
  return undefined;
}

function callableExpressionDeclaration(
  expression: Node,
  source: TargetSourceProgram,
): Node | undefined {
  const { ast } = source;
  let current = expression;
  while (true) {
    const parent = ast.parent(current);
    if (parent === undefined) return undefined;
    if (Node_Initializer(ast, parent) === current) return parent;
    if (!isTransparentExpression(parent, ast) || Node_Expression(ast, parent) !== current) {
      return undefined;
    }
    current = parent;
  }
}

function unwrapCallableExpression(
  expression: Node,
  source: TargetSourceProgram,
): Node {
  const { ast } = source;
  let current = expression;
  while (isTransparentExpression(current, ast)) {
    const inner = Node_Expression(ast, current);
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}

function isTransparentExpression(
  node: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  return ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsTypeAssertion(node) || ast.is.IsNonNullExpression(node) ||
    ast.is.IsSatisfiesExpression(node);
}

function captureEligibleDeclaration(
  declaration: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  return ast.is.IsVariableDeclaration(declaration) ||
    ast.is.IsParameterDeclaration(declaration) ||
    ast.is.IsBindingElement(declaration);
}

function nodeIsWithin(
  node: Node,
  ancestor: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = ast.parent(current);
  }
  return false;
}

function isNestedCallable(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node);
}
