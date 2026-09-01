import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
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
} from "../program/model.js";
import { walkSourceTree } from "../program/traversal.js";
import {
  analyzeMojoExecutableRegion,
} from "../program/executable-regions.js";
import type {
  MojoExecutableRegionAnalysisEnvironment,
} from "../program/executable-regions.js";
import { recordMojoExecutableRegionConversionUses } from "../conversions/uses.js";

export interface MojoCallableExpressionSignatureInput {
  readonly expression: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly jsEnabled: boolean;
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
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
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
  return callable;
}

export interface MojoCallableCaptureInput {
  readonly expression: Node;
  readonly body: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly source: TargetSourceProgram;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly locationStorageNames: WeakMap<Node, string>;
  readonly ensureLocationStorage: (declaration: Node, bindingName: string) => string;
  readonly moduleBindingByDeclaration: WeakMap<Node, unknown>;
  readonly diagnostics: TargetDiagnostic[];
}

export function collectMojoCallableCaptures(
  input: MojoCallableCaptureInput,
): readonly MojoCallableCapture[] | undefined {
  const { ast } = input.source;
  const captures = new Map<Node, MojoCallableCapture>();
  let valid = true;
  let capturesSelf = false;
  walkSourceTree(input.body, ast, (node): void => {
    if (!valid) return;
    if (ast.kindName(node) === "KindThisKeyword") {
      capturesSelf = input.owner !== undefined;
      return;
    }
    if (!ast.is.IsIdentifier(node)) return;
    const reference = input.source.navigation.sourceReferenceFor(node);
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
  }, (node, root) => node === root || !isNestedCallable(node, ast));
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
  return Object.freeze(ordered);
}

export interface MojoCallableExpressionAnalysisInput {
  readonly expression: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly allocateLocalName: (sourceName: string) => string;
  readonly moduleBindingByDeclaration: WeakMap<Node, unknown>;
  readonly ensureLocationStorage: (declaration: Node, bindingName: string) => string;
  readonly selections: WeakMap<Node, MojoCallableExpressionSelection>;
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
    sourceProfiles: environment.sourceProfiles,
    jsEnabled: environment.jsEnabled,
    allocateLocalName: input.allocateLocalName,
    bindingNames: environment.bindingNames,
    bindingTypes: environment.bindingTypes,
    bindingSourceFiles: environment.bindingSourceFiles,
    diagnostics: environment.diagnostics,
  });
  if (callable === undefined) return;
  const region = analyzeMojoExecutableRegion({
    root: callable.body,
    sourceFile: input.sourceFile,
    rootExpectedType: callable.resultType,
    returnType: callable.resultType,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    ...environment,
  });
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
  const captures = collectMojoCallableCaptures({
    expression: input.expression,
    body: callable.body,
    sourceFile: input.sourceFile,
    ...(input.owner === undefined ? {} : { owner: input.owner }),
    source: environment.source,
    bindingNames: environment.bindingNames,
    bindingTypes: environment.bindingTypes,
    locationStorageNames: environment.locationStorageNames,
    ensureLocationStorage: input.ensureLocationStorage,
    moduleBindingByDeclaration: input.moduleBindingByDeclaration,
    diagnostics: environment.diagnostics,
  });
  const selectedType = environment.expressionTypes.get(input.expression);
  if (captures === undefined || selectedType?.kind !== "callable" ||
    selectedType.parameters.length !== callable.parameters.length) {
    if (captures !== undefined) {
      environment.diagnostics.push(mojoAnalysisDiagnostic(
        "MOJO_CALLABLE_EXPRESSION_CARRIER_NOT_CLOSED",
        "A callable expression requires one exact function carrier aligned with its authored parameters.",
        input.expression,
      ));
    }
    return;
  }
  const callableType = Object.freeze({
    ...selectedType,
    result: callable.resultType,
    raises: region.raises,
  });
  environment.expressionTypes.set(input.expression, callableType);
  input.selections.set(input.expression, Object.freeze({
    expression: input.expression,
    parameters: callable.parameters,
    captures,
    resultType: callable.resultType,
    body: callable.body,
    raises: region.raises,
    callableType,
  }));
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
