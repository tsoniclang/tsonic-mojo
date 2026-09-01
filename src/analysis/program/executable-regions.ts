import type { Node, SourceFile, Type } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
  PrefixUnaryExpression_Operand,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type { MojoConversionIndex } from "../conversions/classification.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { analyzeMojoCall } from "../operations/calls.js";
import { analyzeMojoElementAccess } from "../operations/elements.js";
import { analyzeMojoIteration } from "../operations/iterations.js";
import {
  analyzeMojoProjectProperty,
  analyzeMojoProviderProperty,
} from "../operations/properties.js";
import { analyzeMojoProviderValue } from "../operations/values.js";
import { analyzeMojoObjectLiteral } from "../objects/object-literals.js";
import type { MojoProjectTypeCatalog } from "../types/project-catalog.js";
import type { MojoSourceProfileRegistry } from "../types/source-profile.js";
import { resolveMojoTargetType } from "../types/resolution.js";
import { providerCallRequiresRaisingConversion } from "./effects.js";
import { inferMojoExpressionType, isMojoExpressionNode } from "./expression-types.js";
import { isMojoAssignmentOperator } from "./syntax-validation.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedClassOwner,
  MojoAnalyzedFunction,
  MojoAnalyzedProjectProperty,
  MojoCallSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoValueSelection,
} from "./model.js";
import { walkSourceTree, walkSourceTreePostOrder } from "./traversal.js";
import type { MojoSourceModuleCatalog } from "../modules/model.js";

export interface MojoExecutableRegionAnalysisInput {
  readonly root: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly rootExpectedType?: MojoTargetTypeRef;
  readonly returnType?: MojoTargetTypeRef;
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly modules: MojoSourceModuleCatalog;
  readonly jsEnabled: boolean;
  readonly diagnostics: TargetDiagnostic[];
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly elementSelections: WeakMap<Node, MojoElementSelection>;
  readonly iterationSelections: WeakMap<Node, MojoIterationSelection>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly conversions: MojoConversionIndex;
  readonly functionByDeclaration: WeakMap<Node, MojoAnalyzedFunction>;
  readonly classByDeclaration: WeakMap<Node, MojoAnalyzedClass>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly interfaceByTypeId: ReadonlyMap<string, import("./model.js").MojoAnalyzedInterface>;
  readonly fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
  readonly sourceValueOccurrenceKinds: WeakMap<Node, "runtime" | "non-runtime">;
  readonly indexedSourceUseDeclarations: WeakSet<Node>;
  readonly analyzeCallableExpression: (
    expression: Node,
    sourceFile: SourceFile,
    owner: MojoAnalyzedClassOwner | undefined,
  ) => void;
}

export type MojoExecutableRegionAnalysisEnvironment = Omit<
  MojoExecutableRegionAnalysisInput,
  "root" | "sourceFile" | "owner" | "rootExpectedType" | "returnType"
>;

export interface MojoExecutableRegionAnalysis {
  readonly dependencies: ReadonlySet<Node>;
  readonly raises: boolean;
}

export function analyzeMojoExecutableRegion(
  input: MojoExecutableRegionAnalysisInput,
): MojoExecutableRegionAnalysis {
  const { source, root, sourceFile } = input;
  const { ast } = source;
  const semantics = source.semantics.forFile(sourceFile);
  const dependencies = new Set<Node>();
  const iterationNodes: Node[] = [];
  const objectLiteralNodes: Node[] = [];
  const callableExpressionNodes: Node[] = [];
  walkSourceTree(root, ast, (node): void => {
    if (ast.is.IsVariableDeclaration(node)) {
      const selected = declaredOrInitializerType(node, semantics, ast);
      const resolved = resolveType(selected, ast.typeNode(node), input, semantics);
      if (resolved === undefined) {
        input.diagnostics.push(typeDiagnostic(node, "the selected declaration has no closed Mojo carrier"));
      } else {
        input.bindingTypes.set(node, resolved);
      }
    }
    if (isMojoExpressionNode(node, ast) && isRuntimeValueOccurrence(node, input)) {
      analyzeExpressionCarrier(node, input, semantics);
    }
    if (ast.is.IsForOfStatement(node) || ast.is.IsForInStatement(node)) iterationNodes.push(node);
    if (ast.is.IsObjectLiteralExpression(node)) objectLiteralNodes.push(node);
    if (ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node)) callableExpressionNodes.push(node);
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, ast));

  for (const expression of callableExpressionNodes) {
    input.analyzeCallableExpression(expression, sourceFile, input.owner);
  }

  walkSourceTreePostOrder(root, ast, (node): void => {
    if (ast.is.IsPropertyAccessExpression(node)) analyzeProperty(node, input, semantics);
    if (ast.is.IsElementAccessExpression(node)) analyzeElement(node, input, semantics);
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
      analyzeCall(node, input, semantics, dependencies);
    }
    if (!isMojoExpressionNode(node, ast) || !isRuntimeValueOccurrence(node, input)) return;
    const inferred = inferMojoExpressionType(node, ast, input.expressionTypes);
    if (inferred !== undefined) input.expressionTypes.set(node, inferred);
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, ast));

  const pendingObjects = new Set(objectLiteralNodes);
  let progressed = true;
  while (pendingObjects.size !== 0 && progressed) {
    progressed = false;
    for (const node of pendingObjects) {
      const expectedType = expectedExpressionType(node, input);
      const inferredType = input.expressionTypes.get(node);
      const candidate = expectedType ?? inferredType;
      if (candidate?.kind !== "target-named" || !input.interfaceByTypeId.has(candidate.id)) {
        pendingObjects.delete(node);
        continue;
      }
      const selection = analyzeMojoObjectLiteral({
        source: input.source,
        sourceFile,
        expression: node,
        expressionTypes: input.expressionTypes,
        ...(expectedType === undefined ? {} : { expectedType }),
        interfaceByTypeId: input.interfaceByTypeId,
        fieldByDeclaration: input.fieldByDeclaration,
        resolveType(type) {
          return resolveType(type, undefined, input, semantics);
        },
        diagnostics: input.diagnostics,
      });
      pendingObjects.delete(node);
      if (selection !== undefined) {
        input.objectLiteralSelections.set(node, selection);
        progressed = true;
      }
    }
  }

  for (const node of iterationNodes) {
    const selected = semantics.operations.iteration(node);
    const iterable = Node_Expression(ast, node);
    if (selected === undefined || iterable === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_ITERATION_EVIDENCE_MISSING",
        "Iteration lowering requires one exact checker-selected iteration operation.",
        node,
      ));
      continue;
    }
    const iteration = analyzeMojoIteration({
      ast,
      statement: node,
      iterable,
      source: selected,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      resolveType(type) {
        return resolveType(type, undefined, input, semantics);
      },
    });
    if (iteration.kind === "unsupported") {
      input.diagnostics.push(diagnostic(iteration.code, iteration.reason, node));
    } else {
      input.iterationSelections.set(node, iteration.selection);
    }
  }
  return Object.freeze({ dependencies, raises: regionRaises(root, input) });
}

function expectedExpressionType(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): MojoTargetTypeRef | undefined {
  const { ast } = input.source;
  if (node === input.root && input.rootExpectedType !== undefined) return input.rootExpectedType;
  const parent = ast.parent(node);
  if (parent === undefined) return undefined;
  if (ast.is.IsVariableDeclaration(parent) && Node_Initializer(ast, parent) === node) {
    return input.bindingTypes.get(parent);
  }
  if (ast.is.IsReturnStatement(parent) && Node_Expression(ast, parent) === node) {
    return input.returnType;
  }
  if (ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) {
    return input.callSelections.get(parent)?.arguments.find((argument) => argument.expression === node)?.parameterType;
  }
  if (ast.is.IsArrayLiteralExpression(parent)) {
    const index = ast.elements(parent).findIndex((element) => element === node);
    const aggregate = input.expressionTypes.get(parent);
    if (index < 0 || aggregate === undefined) return undefined;
    if (aggregate.kind === "list" || aggregate.kind === "fixed-array") return aggregate.element;
    if (aggregate.kind === "tuple") return aggregate.elements[index];
    if (aggregate.kind === "target-named" && aggregate.id === "tsonic.mojo.js.JsArray") {
      const argument = aggregate.genericArguments?.[0];
      return argument?.kind === "type" ? argument.type : undefined;
    }
  }
  if (ast.is.IsPrefixUnaryExpression(parent) && PrefixUnaryExpression_Operand(ast, parent) === node) {
    return ast.operatorKindName(parent) === "KindExclamationToken"
      ? Object.freeze({ kind: "source-primitive", name: "bool" })
      : input.expressionTypes.get(parent);
  }
  if (ast.is.IsPropertyAssignment(parent) || ast.is.IsShorthandPropertyAssignment(parent)) {
    const owner = ast.parent(parent);
    const selection = owner === undefined ? undefined : input.objectLiteralSelections.get(owner);
    const contribution = selection?.contributions.find((candidate) =>
      candidate.kind === "field" && candidate.element === parent);
    return contribution?.kind === "field" ? contribution.fieldType : undefined;
  }
  const parentOperator = ast.operatorKindName(parent);
  if (ast.is.IsBinaryExpression(parent) && BinaryExpression_Right(ast, parent) === node &&
    parentOperator !== undefined && isMojoAssignmentOperator(parentOperator)) {
    const left = BinaryExpression_Left(ast, parent);
    if (left === undefined) return undefined;
    const property = input.propertySelections.get(left);
    const element = input.elementSelections.get(left);
    return property?.kind === "provider"
      ? property.writeOperation?.parameterTypes[0]
      : element?.writeType ?? input.expressionTypes.get(left);
  }
  if ((ast.is.IsAsExpression(parent) || ast.is.IsTypeAssertion(parent) ||
      ast.is.IsSatisfiesExpression(parent)) && Node_Expression(ast, parent) === node) {
    return input.expressionTypes.get(parent);
  }
  return undefined;
}

function analyzeCall(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  dependencies: Set<Node>,
): void {
  const selectedCall = semantics.operations.call(node);
  if (selectedCall === undefined || selectedCall.sourceSelectedSignatureKind !== "resolved") {
    input.diagnostics.push(diagnostic(
      "MOJO_CALL_EVIDENCE_MISSING",
      "Call lowering requires one exact checker-selected signature.",
      node,
    ));
    return;
  }
  const analyzed = analyzeMojoCall(node, selectedCall, {
    source: input.source,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
    expressionTypes: input.expressionTypes,
    conversions: input.conversions,
    functionByDeclaration: input.functionByDeclaration,
    classByDeclaration: input.classByDeclaration,
    classByTypeId: input.classByTypeId,
    modulePathForSourceFile(owner) {
      return input.modules.forSourceFile(owner)?.modulePath ?? Object.freeze([]);
    },
  });
  if (analyzed.kind === "unsupported") {
    input.diagnostics.push(diagnostic(analyzed.code, analyzed.reason, node));
    return;
  }
  if (analyzed.dependency !== undefined) dependencies.add(analyzed.dependency);
  input.callSelections.set(node, analyzed.selection);
  if (analyzed.selection.kind === "project" || analyzed.selection.kind === "callable") {
    input.expressionTypes.set(node, analyzed.selection.resultType);
  }
}

function analyzeExpressionCarrier(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): void {
  const { ast } = input.source;
  const reference = ast.is.IsIdentifier(node)
    ? input.source.navigation.sourceReferenceFor(node)
    : undefined;
  const referencedName = reference === undefined ? undefined : input.bindingNames.get(reference.declaration);
  if (referencedName !== undefined) input.bindingNames.set(node, referencedName);
  if (reference !== undefined) input.bindingSourceFiles.set(node, reference.sourceFile);
  const referencedType = reference === undefined ? undefined : input.bindingTypes.get(reference.declaration);
  const contextualExpected = expectedExpressionType(node, input);
  const resolved = referencedType ?? contextualExpected ??
    resolveType(semantics.types.expressionType(node), undefined, input, semantics);
  if (resolved !== undefined) input.expressionTypes.set(node, resolved);
  if (ast.is.IsIdentifier(node) && referencedName === undefined && resolved !== undefined &&
    providerValueReferenceRole(node, ast)) {
    const value = analyzeMojoProviderValue(
      node,
      resolved,
      input.source,
      input.providerSemantics,
      input.conversions,
    );
    if (value.kind === "unsupported") {
      input.diagnostics.push(diagnostic(value.code, value.reason, node));
    } else if (value.kind === "resolved") {
      input.valueSelections.set(node, value.selection);
    }
  }
  if (ast.kindName(node) === "KindThisKeyword" && input.owner !== undefined) {
    input.bindingNames.set(node, "self");
    input.expressionTypes.set(node, input.owner.type);
  }
}

function analyzeProperty(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): void {
  const selected = semantics.operations.propertyAccess(node);
  if (selected === undefined) {
    input.diagnostics.push(diagnostic(
      "MOJO_PROPERTY_EVIDENCE_MISSING",
      "Property lowering requires one exact checker-selected access.",
      node,
    ));
    return;
  }
  const resolve = (type: Type): MojoTargetTypeRef | undefined => resolveType(type, undefined, input, semantics);
  const project = analyzeMojoProjectProperty(
    selected,
    input.fieldByDeclaration,
    resolve(selected.receiver.type),
  );
  const property = project.kind === "not-project-field"
    ? analyzeMojoProviderProperty(selected, {
        source: input.source,
        providerSemantics: input.providerSemantics,
        conversions: input.conversions,
        resolveType: resolve,
      })
    : project;
  if (property.kind === "unsupported") {
    input.diagnostics.push(diagnostic(property.code, property.reason, node));
  } else if (property.kind === "resolved") {
    input.propertySelections.set(node, property.selection);
    input.expressionTypes.set(node, property.expressionType);
  }
}

function analyzeElement(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): void {
  const selected = semantics.operations.elementAccess(node);
  if (selected === undefined) {
    input.diagnostics.push(diagnostic(
      "MOJO_ELEMENT_EVIDENCE_MISSING",
      "Element lowering requires one exact checker-selected access.",
      node,
    ));
    return;
  }
  const element = analyzeMojoElementAccess(selected, {
    source: input.source,
    providerSemantics: input.providerSemantics,
    conversions: input.conversions,
    expressionTypes: input.expressionTypes,
    resolveType(type) {
      return resolveType(type, undefined, input, semantics);
    },
  });
  if (element.kind === "unsupported") {
    input.diagnostics.push(diagnostic(element.code, element.reason, node));
  } else {
    input.elementSelections.set(node, element.selection);
    input.expressionTypes.set(node, element.expressionType);
  }
}

function regionRaises(root: Node, input: MojoExecutableRegionAnalysisInput): boolean {
  let raises = false;
  walkSourceTree(root, input.source.ast, (node): void => {
    if (input.source.ast.is.IsCallExpression(node) || input.source.ast.is.IsNewExpression(node)) {
      const selection = input.callSelections.get(node);
      if (selection?.kind === "provider") {
        raises = raises || selection.operation.raises || providerCallRequiresRaisingConversion(selection);
      }
    }
    if (input.source.ast.is.IsThrowStatement(node)) raises = true;
    if (input.source.ast.is.IsPropertyAccessExpression(node)) {
      const selection = input.propertySelections.get(node);
      if (selection?.kind === "provider") {
        raises = raises || selection.readOperation?.raises === true ||
          selection.writeOperation?.raises === true ||
          selection.receiverConversion?.kind === "js-to-native-string" ||
          selection.readResultConversion?.kind === "js-to-native-string";
      } else if (selection?.kind === "provider-constant") {
        raises = raises || selection.operation.raises ||
          selection.readResultConversion.kind === "js-to-native-string";
      }
    }
    if (input.source.ast.is.IsIdentifier(node)) {
      const selection = input.valueSelections.get(node);
      raises = raises || selection?.operation.raises === true ||
        selection?.resultConversion.kind === "js-to-native-string";
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, input.source.ast));
  return raises;
}

function descendWithinExecutableRegion(
  node: Node,
  root: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  if (node === root) return true;
  return !isCallableBoundary(node, ast);
}

function isCallableBoundary(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsFunctionDeclaration(node) ||
    ast.is.IsFunctionExpression(node) ||
    ast.is.IsArrowFunction(node) ||
    ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) ||
    ast.is.IsSetAccessorDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node);
}

function resolveType(
  type: Type | undefined,
  authoredTypeNode: Node | undefined,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const resolved = resolveMojoTargetType(type, authoredTypeNode, {
    ast: input.source.ast,
    semantics,
    sourceFacts: input.source.sourceFacts,
    providerSemantics: input.providerSemantics,
    projectTypes: input.projectTypes,
    sourceProfiles: input.sourceProfiles,
    jsEnabled: input.jsEnabled,
  });
  return resolved.kind === "resolved" ? resolved.type : undefined;
}

function declaredOrInitializerType(
  declaration: Node,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
  ast: TargetSourceProgram["ast"],
): Type | undefined {
  const authored = ast.typeNode(declaration);
  const initializer = Node_Initializer(ast, declaration);
  return semantics.declarations.declaredValueType(declaration) ??
    semantics.declarations.declaredType(declaration) ??
    (authored === undefined ? undefined : semantics.types.authoredType(authored)) ??
    (initializer === undefined ? undefined : semantics.types.expressionType(initializer));
}

function providerValueReferenceRole(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  const parent = ast.parent(node);
  if (parent === undefined) return true;
  if ((ast.is.IsCallExpression(parent) || ast.is.IsNewExpression(parent)) &&
    Node_Expression(ast, parent) === node) return false;
  if (ast.is.IsPropertyAccessExpression(parent)) return false;
  return true;
}

function isRuntimeValueOccurrence(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  if (!input.source.ast.is.IsIdentifier(node)) return true;
  const reference = input.source.navigation.sourceReferenceFor(node);
  if (reference === undefined) return true;
  if (!input.indexedSourceUseDeclarations.has(reference.declaration)) {
    input.indexedSourceUseDeclarations.add(reference.declaration);
    for (const use of input.source.navigation.declarationUses(reference.declaration)) {
      input.sourceValueOccurrenceKinds.set(
        use.reference,
        use.kind === "type-only" || use.kind === "source-linkage" ? "non-runtime" : "runtime",
      );
    }
  }
  return input.sourceValueOccurrenceKinds.get(node) === "runtime";
}

function typeDiagnostic(node: Node, reason: string): TargetDiagnostic {
  return diagnostic(
    "MOJO_TARGET_TYPE_UNSUPPORTED",
    `Selected source type cannot be represented exactly in Mojo: ${reason}.`,
    node,
  );
}
