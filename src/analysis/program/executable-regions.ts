import { argumentPassingFactKey, pointerOperationFactKey, rawPointerOperationFactKey } from "@tsonic/tsts";
import type { AstReader, Node, SourceFile, Type } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
  TryStatement_FinallyBlock,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { analyzeMojoCall } from "../operations/calls.js";
import { mojoCallResultType } from "../operations/call-results.js";
import { analyzeMojoElementAccess } from "../operations/elements.js";
import { analyzeMojoIteration } from "../operations/iterations.js";
import { analyzeMojoBindingPattern } from "../bindings/patterns.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import { mojoLocationTargetType } from "../operations/typed-locations.js";
import { mojoRawPointerTargetType } from "../operations/raw-pointers.js";
import { analyzeMojoProjectProperty } from "../operations/project-fields.js";
import { analyzeMojoProviderProperty } from "../operations/properties.js";
import { analyzeMojoStructuralProperty } from "../operations/structural-fields.js";
import { analyzeMojoObjectLiteral } from "../objects/object-literals.js";
import { analyzeMojoResourceManagement } from "../resources/management.js";
import { analyzeMojoProviderRecordLiteral } from "../objects/provider-records.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { inferMojoExpressionType, isMojoExpressionNode } from "./expression-types.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedClassOwner,
  MojoBindingPatternSelection,
  MojoAnalyzedFunction,
  MojoAnalyzedProjectProperty,
  MojoCallSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTemplateExpressionSelection,
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";
import { walkSourceTree, walkSourceTreePostOrder } from "./traversal.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import { expectedExpressionType } from "./expected-types.js";
import {
  analyzeExecutableRegionProviderValues,
  declaredOrInitializerType,
  descendWithinExecutableRegion,
  executableRegionRaises,
  isRuntimeValueOccurrence,
  resolveExecutableRegionType as resolveType,
  targetTypeDiagnostic as typeDiagnostic,
} from "./executable-region-support.js";
import { mojoParameterAbi } from "../../policy/callables/parameter-abi.js";
import { analyzeMojoTemplateExpression } from "../operations/template-expressions.js";
import { classifyMojoValueRefinement } from "../refinements/value.js";

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
  readonly resourceManagementSelections: WeakMap<Node, MojoResourceManagementSelection>;
  readonly resourceDeclarations: Set<Node>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly typeTestSelections: WeakMap<Node, MojoTypeTestSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly templateExpressionSelections: WeakMap<Node, MojoTemplateExpressionSelection>;
  readonly bindingPatternSelections: WeakMap<Node, MojoBindingPatternSelection>;
  readonly returnValueTransfers: WeakSet<Node>;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly conversions: MojoConversionIndex;
  readonly functionByDeclaration: WeakMap<Node, MojoAnalyzedFunction>;
  readonly classByDeclaration: WeakMap<Node, MojoAnalyzedClass>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly locationStorageNames: WeakMap<Node, string>;
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
  const resourceDeclarations: Node[] = [];
  const objectLiteralNodes: Node[] = [];
  const callableExpressionNodes: Node[] = [];
  const bindingPatternDeclarations: Node[] = [];
  const returnExpressions: Node[] = [];
  walkSourceTree(root, ast, (node): void => {
    if (ast.is.IsVariableDeclaration(node)) {
      const declarationKind = ast.variableDeclarationKind(node);
      if (declarationKind === "using" || declarationKind === "await using") {
        resourceDeclarations.push(node);
        input.resourceDeclarations.add(node);
      }
      const name = ast.name(node);
      const bindingPattern = name !== undefined &&
        (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name));
      const authoredType = ast.typeNode(node);
      const initializer = Node_Initializer(ast, node);
      const resolved = bindingPattern && authoredType === undefined
        ? undefined
        : authoredType === undefined && initializer !== undefined
        ? resolveInferredBindingCarrier(initializer, input, semantics)
        : resolveType(
            declaredOrInitializerType(node, semantics, ast),
            authoredType,
            input,
            semantics,
          );
      if (resolved === undefined && !bindingPattern) {
        input.diagnostics.push(typeDiagnostic(node, "the selected declaration has no closed Mojo carrier"));
      } else {
        if (resolved !== undefined) input.bindingTypes.set(node, resolved);
      }
      if (bindingPattern) {
        bindingPatternDeclarations.push(node);
      }
    }
    if (isMojoExpressionNode(node, ast) && isRuntimeValueOccurrence(node, input)) {
      analyzeExpressionCarrier(node, input, semantics);
    }
    if (ast.is.IsForOfStatement(node) || ast.is.IsForInStatement(node)) iterationNodes.push(node);
    if (ast.is.IsObjectLiteralExpression(node)) objectLiteralNodes.push(node);
    if (ast.is.IsFunctionExpression(node) || ast.is.IsArrowFunction(node)) callableExpressionNodes.push(node);
    if (ast.is.IsReturnStatement(node)) {
      const expression = Node_Expression(ast, node);
      if (expression !== undefined) returnExpressions.push(expression);
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, ast));

  for (const expression of callableExpressionNodes) {
    input.analyzeCallableExpression(expression, sourceFile, input.owner);
  }

  const pendingBindingPatterns = new Set(bindingPatternDeclarations);
  const analyzeBindingPatternDeclaration = (
    declaration: Node,
    sourceType: MojoTargetTypeRef | undefined,
  ): void => {
    const initializer = Node_Initializer(ast, declaration);
    if (initializer === undefined || sourceType === undefined) return;
    const selection = analyzeMojoBindingPattern({
      ast,
      declaration,
      initializer,
      sourceType,
      sourceReuse: ast.is.IsIdentifier(initializer) &&
        input.source.navigation.sourceReferenceFor(initializer)?.project === true
        ? "direct"
        : "stabilized",
      sourceSemanticType: semantics.types.expressionType(initializer),
      semantics,
      resolveType(type) {
        return resolveType(type, undefined, input, semantics);
      },
      expressionTypes: input.expressionTypes,
      conversions: input.conversions,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      classByTypeId: input.classByTypeId,
      interfaceByTypeId: input.interfaceByTypeId,
      structuralObjects: input.structuralObjects,
      diagnostics: input.diagnostics,
    });
    if (selection === undefined) return;
    input.bindingTypes.set(declaration, sourceType);
    input.bindingPatternSelections.set(declaration, selection);
    publishBindingPatternCarriers(selection.elements, input);
    pendingBindingPatterns.delete(declaration);
  };
  for (const declaration of pendingBindingPatterns) {
    const initializer = Node_Initializer(ast, declaration);
    const sourceType = input.bindingTypes.get(declaration) ??
      (initializer !== undefined && ast.is.IsIdentifier(initializer)
        ? input.expressionTypes.get(initializer)
        : undefined);
    analyzeBindingPatternDeclaration(declaration, sourceType);
  }

  for (const expression of returnExpressions) {
    if (selectReturnValueTransfer(expression, input)) {
      input.returnValueTransfers.add(expression);
    }
  }

  walkSourceTreePostOrder(root, ast, (node): void => {
    if (ast.is.IsPropertyAccessExpression(node)) analyzeProperty(node, input, semantics);
    if (ast.is.IsElementAccessExpression(node)) analyzeElement(node, input, semantics);
    if (ast.is.IsCallExpression(node) || ast.is.IsNewExpression(node)) {
      analyzeCall(node, input, semantics, dependencies);
    }
    if (ast.is.IsBinaryExpression(node)) {
      if (ast.operatorKindName(node) === "KindInstanceOfKeyword") {
        analyzeTypeTest(node, input);
      } else {
        analyzeNullishComparison(node, input);
      }
    }
    if (ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) ||
      ast.is.IsNonNullExpression(node)) {
      analyzeErasedValueRefinement(node, input, semantics);
    }
    if (ast.kindName(node) === "KindTemplateExpression") {
      const template = analyzeMojoTemplateExpression(node, source, input.expressionTypes);
      if (template.kind === "unsupported") {
        input.diagnostics.push(diagnostic(
          "MOJO_TEMPLATE_STRING_CONVERSION_UNSUPPORTED",
          template.reason,
          template.node,
        ));
      } else {
        input.templateExpressionSelections.set(node, template.selection);
      }
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
      const projectInterfaceCandidate = candidate?.kind === "target-named"
        ? input.interfaceByTypeId.has(candidate.id)
        : candidate?.kind === "union" && candidate.members.some((member) =>
          member.kind === "target-named" && input.interfaceByTypeId.has(member.id));
      if (candidate === undefined ||
        (candidate.kind !== "target-named" && candidate.kind !== "union")) {
        pendingObjects.delete(node);
        continue;
      }
      const selection = projectInterfaceCandidate
        ? analyzeMojoObjectLiteral({
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
          })
        : candidate.kind === "target-named" ? analyzeMojoProviderRecordLiteral({
            source: input.source,
            sourceFile,
            expression: node,
            expressionTypes: input.expressionTypes,
            ...(expectedType === undefined ? {} : { expectedType }),
            providerSemantics: input.providerSemantics,
            conversions: input.conversions,
            resolveType(type) {
              return resolveType(type, undefined, input, semantics);
            },
            diagnostics: input.diagnostics,
          }) : undefined;
      pendingObjects.delete(node);
      if (selection !== undefined) {
        input.objectLiteralSelections.set(node, selection);
        progressed = true;
      }
    }
  }

  for (const declaration of pendingBindingPatterns) {
    const initializer = Node_Initializer(ast, declaration);
    const authoredType = ast.typeNode(declaration);
    const sourceType = initializer === undefined
      ? undefined
      : authoredType === undefined
        ? input.expressionTypes.get(initializer) ?? input.bindingTypes.get(declaration)
        : input.bindingTypes.get(declaration) ?? input.expressionTypes.get(initializer);
    if (initializer === undefined || sourceType === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_BINDING_PATTERN_SOURCE_NOT_CLOSED",
        "A binding pattern requires one initialized source with an exact Mojo carrier.",
        declaration,
      ));
      continue;
    }
    analyzeBindingPatternDeclaration(declaration, sourceType);
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
  let resourceRaises = false;
  for (const declaration of resourceDeclarations) {
    const sourceInfo = semantics.operations.resourceManagement(declaration);
    if (sourceInfo === undefined) {
      input.diagnostics.push(diagnostic(
        "MOJO_RESOURCE_MANAGEMENT_EVIDENCE_MISSING",
        "Resource lowering requires one exact checker-selected disposal operation.",
        declaration,
      ));
      continue;
    }
    const resource = analyzeMojoResourceManagement({
      declaration,
      source: input.source,
      sourceInfo,
      providerSemantics: input.providerSemantics,
      functionByDeclaration: input.functionByDeclaration,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      resolveType(type) {
        return resolveType(type, undefined, input, semantics);
      },
    });
    if (resource.kind === "unsupported") {
      input.diagnostics.push(diagnostic(resource.code, resource.reason, declaration));
      continue;
    }
    input.resourceManagementSelections.set(declaration, resource.selection);
    for (const alternative of resource.selection.alternatives) {
      if (alternative.disposal.kind === "project") {
        dependencies.add(alternative.disposal.dependency);
      } else {
        resourceRaises = resourceRaises || alternative.disposal.operation.raises;
      }
    }
  }
  analyzeExecutableRegionProviderValues(root, input);
  return Object.freeze({
    dependencies,
    raises: resourceRaises || executableRegionRaises(root, input),
  });
}

function selectReturnValueTransfer(
  expression: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  const { ast } = input.source;
  if (!ast.is.IsIdentifier(expression)) return false;
  const reference = input.source.navigation.sourceReferenceFor(expression);
  const declaration = reference?.project === true ? reference.declaration : undefined;
  if (declaration === undefined || input.locationStorageNames.has(declaration) ||
    input.resourceDeclarations.has(declaration) || returnFinallyUsesDeclaration(expression, declaration, input)) {
    return false;
  }
  if (ast.is.IsParameterDeclaration(declaration)) {
    const mode = input.source.sourceFacts.getFact(declaration, argumentPassingFactKey)?.mode;
    return mojoParameterAbi(mode).convention === "var";
  }
  if (ast.is.IsBindingElement(declaration)) {
    return sourceNodeIsWithin(declaration, input.root, ast) &&
      !isIterationBindingDeclaration(declaration, ast);
  }
  return ast.is.IsVariableDeclaration(declaration) &&
    sourceNodeIsWithin(declaration, input.root, ast) &&
    !isIterationBindingDeclaration(declaration, ast);
}

function returnFinallyUsesDeclaration(
  expression: Node,
  declaration: Node,
  input: MojoExecutableRegionAnalysisInput,
): boolean {
  const { ast } = input.source;
  const uses = input.source.navigation.declarationUses(declaration);
  let current: Node | undefined = expression;
  while (current !== undefined && current !== input.root) {
    const parent = ast.parent(current);
    if (parent === undefined) break;
    if (ast.is.IsTryStatement(parent)) {
      const finallyBlock = TryStatement_FinallyBlock(ast, parent);
      if (finallyBlock !== undefined && !sourceNodeIsWithin(current, finallyBlock, ast) &&
        uses.some(({ reference }) => sourceNodeIsWithin(reference, finallyBlock, ast))) {
        return true;
      }
    }
    current = parent;
  }
  return false;
}

function isIterationBindingDeclaration(
  declaration: Node,
  ast: AstReader,
): boolean {
  let current: Node | undefined = declaration;
  while (current !== undefined) {
    const parent = ast.parent(current);
    if (parent === undefined) return false;
    if (ast.is.IsForOfStatement(parent) || ast.is.IsForInStatement(parent)) return true;
    if (!ast.is.IsVariableDeclarationList(parent) && !ast.is.IsBindingElement(parent) &&
      !ast.is.IsArrayBindingPattern(parent) && !ast.is.IsObjectBindingPattern(parent)) return false;
    current = parent;
  }
  return false;
}

function sourceNodeIsWithin(
  node: Node,
  root: Node,
  ast: AstReader,
): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (current === root) return true;
    current = ast.parent(current);
  }
  return false;
}

function publishBindingPatternCarriers(
  elements: readonly MojoBindingPatternSelection["elements"][number][],
  input: MojoExecutableRegionAnalysisInput,
): void {
  for (const element of elements) {
    if (element.target.kind === "pattern") {
      publishBindingPatternCarriers(element.target.elements, input);
      continue;
    }
    for (const use of input.source.navigation.declarationUses(element.target.declaration)) {
      if (use.kind !== "type-only" && use.kind !== "source-linkage") {
        input.expressionTypes.set(use.reference, element.target.type);
      }
    }
  }
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
    locationStorageNames: input.locationStorageNames,
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
  input.expressionTypes.set(node, mojoCallResultType(analyzed.selection));
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
  const selectedOccurrenceType = referencedType === undefined
    ? undefined
    : analyzeReferencedValueRefinement(node, referencedType, input, semantics);
  const erasedCarrier = isErasedValueWrapper(node, ast)
    ? resolveErasedExpressionCarrier(node, input, semantics)
    : undefined;
  const semanticType = resolveType(
    semantics.types.expressionType(node),
    undefined,
    input,
    semantics,
  );
  const exactSemanticFirst = ast.is.IsIdentifier(node) ||
    ast.kindName(node) === "KindTemplateExpression" ||
    ast.kindName(node) === "KindNullKeyword" ||
    ast.kindName(node) === "KindUndefinedKeyword";
  const resolved = selectedOccurrenceType ?? referencedType ?? erasedCarrier ??
    (exactSemanticFirst ? semanticType ?? contextualExpected : contextualExpected ?? semanticType);
  if (resolved !== undefined) input.expressionTypes.set(node, resolved);
  if (ast.kindName(node) === "KindThisKeyword" && input.owner !== undefined) {
    input.bindingNames.set(node, "self");
    input.expressionTypes.set(node, input.owner.type);
  }
}

function analyzeReferencedValueRefinement(
  node: Node,
  declaredTargetType: MojoTargetTypeRef,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const selected = input.source.semantics.selectValueTypeRefinement(node);
  if (selected.kind !== "resolved" || selected.refinement.kind !== "members") return undefined;
  const selectedTargetType = resolveType(
    semantics.types.expressionType(node),
    undefined,
    input,
    semantics,
  );
  if (selectedTargetType === undefined) return undefined;
  const refinement = classifyMojoValueRefinement(declaredTargetType, selectedTargetType);
  if (refinement === undefined) return undefined;
  input.valueRefinements.set(node, refinement);
  return refinement.resultType;
}

function analyzeErasedValueRefinement(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): void {
  const inner = Node_Expression(input.source.ast, node);
  if (inner === undefined) return;
  const sourceType = semantics.types.expressionType(inner);
  const selectedType = semantics.types.expressionType(node);
  const sourceTargetType = input.expressionTypes.get(inner);
  const selectedTargetType = resolveType(
    selectedType,
    input.source.ast.typeNode(node),
    input,
    semantics,
  );
  if (sourceType === undefined || selectedType === undefined || sourceTargetType === undefined ||
    selectedTargetType === undefined) return;
  const sourceRefinement = semantics.types.refinement(sourceType, selectedType);
  const mechanicallySelected = sourceRefinement.kind === "members"
    ? sourceRefinement.types.length > 0
    : sourceRefinement.kind === "exact" &&
      semantics.types.isIdentical(sourceType, selectedType);
  if (!mechanicallySelected) return;
  const refinement = classifyMojoValueRefinement(sourceTargetType, selectedTargetType);
  if (refinement !== undefined) input.valueRefinements.set(node, refinement);
}

function resolveInferredBindingCarrier(
  initializer: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const rawPointer = input.source.sourceFacts.getFact(initializer, rawPointerOperationFactKey);
  if (rawPointer?.operation === "bind-raw-pointer") return mojoRawPointerTargetType();
  const pointer = input.source.sourceFacts.getFact(initializer, pointerOperationFactKey);
  if (pointer?.operation === "address-of" || pointer?.operation === "allocate") {
    const exactOperand = pointer.operation === "address-of"
      ? (pointer.storageDeclaration === undefined
          ? input.expressionTypes.get(pointer.storageExpression)
          : input.bindingTypes.get(pointer.storageDeclaration))
      : input.expressionTypes.get(pointer.initialExpression);
    const pointee = exactOperand ?? resolveType(
        pointer.pointeeType,
        pointer.explicitPointeeTypeNode,
        input,
        semantics,
      );
    if (pointee !== undefined) return mojoLocationTargetType(pointee);
  }
  return isErasedValueWrapper(initializer, input.source.ast)
    ? resolveErasedExpressionCarrier(initializer, input, semantics)
    : resolveType(semantics.types.expressionType(initializer), undefined, input, semantics);
}

function resolveErasedExpressionCarrier(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const { ast } = input.source;
  const inner = Node_Expression(ast, node);
  if (inner === undefined) return undefined;
  const sourceCarrier = input.expressionTypes.get(inner) ??
    (isErasedValueWrapper(inner, ast)
      ? resolveErasedExpressionCarrier(inner, input, semantics)
      : resolveType(semantics.types.expressionType(inner), undefined, input, semantics));
  if (sourceCarrier === undefined || ast.is.IsParenthesizedExpression(node) ||
    ast.is.IsSatisfiesExpression(node)) return sourceCarrier;
  const selectedSourceType = semantics.types.expressionType(node);
  const selectedCarrier = resolveType(
    selectedSourceType,
    ast.typeNode(node),
    input,
    semantics,
  );
  if (selectedCarrier === undefined) return sourceCarrier;
  if (classifyMojoValueRefinement(sourceCarrier, selectedCarrier) !== undefined) return selectedCarrier;
  if (ast.is.IsNonNullExpression(node)) return sourceCarrier;
  return classifyMojoValueConversion(sourceCarrier, selectedCarrier).kind === "resolved"
    ? selectedCarrier
    : sourceCarrier;
}

function isErasedValueWrapper(
  node: Node,
  ast: TargetSourceProgram["ast"],
): boolean {
  return ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsTypeAssertion(node) || ast.is.IsNonNullExpression(node) ||
    ast.is.IsSatisfiesExpression(node);
}

function analyzeTypeTest(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): void {
  const left = BinaryExpression_Left(input.source.ast, node);
  const right = BinaryExpression_Right(input.source.ast, node);
  if (left === undefined || right === undefined || !input.source.ast.is.IsIdentifier(right)) return;
  const reference = input.source.navigation.sourceReferenceFor(right);
  const definition = input.projectTypes.definitionForDeclaration(reference?.declaration);
  const sourceType = input.expressionTypes.get(left);
  if (definition?.kind !== "class" || sourceType === undefined) return;
  const testedType = selectedProjectTypeTestMember(sourceType, definition.id);
  if (testedType === undefined) return;
  let selection: MojoTypeTestSelection;
  if (mojoTargetTypeEquals(sourceType, testedType)) {
    selection = Object.freeze({ kind: "constant", value: true, operand: left });
  } else if (sourceType.kind === "optional" && mojoTargetTypeEquals(sourceType.value, testedType)) {
    selection = Object.freeze({ kind: "optional-presence", operand: left, sourceType });
  } else if (sourceType.kind === "union") {
    selection = Object.freeze({ kind: "union-member", operand: left, sourceType, testedType });
  } else {
    return;
  }
  input.typeTestSelections.set(node, selection);
  input.expressionTypes.set(node, Object.freeze({ kind: "source-primitive", name: "bool" }));
}

function analyzeNullishComparison(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
): void {
  const operator = input.source.ast.operatorKindName(node);
  const equality = operator === "KindEqualsEqualsToken" ||
    operator === "KindEqualsEqualsEqualsToken";
  const inequality = operator === "KindExclamationEqualsToken" ||
    operator === "KindExclamationEqualsEqualsToken";
  if (!equality && !inequality) return;
  const strict = operator === "KindEqualsEqualsEqualsToken" ||
    operator === "KindExclamationEqualsEqualsToken";
  const left = BinaryExpression_Left(input.source.ast, node);
  const right = BinaryExpression_Right(input.source.ast, node);
  if (left === undefined || right === undefined) return;
  const leftType = input.expressionTypes.get(left);
  const rightType = input.expressionTypes.get(right);
  if (leftType === undefined || rightType === undefined) return;
  const leftNullish = exactNullishTarget(leftType);
  const rightNullish = exactNullishTarget(rightType);
  if (leftNullish === undefined && rightNullish === undefined) return;
  if (leftNullish !== undefined && rightNullish !== undefined) {
    const equal = !strict || leftNullish.kind === rightNullish.kind;
    input.typeTestSelections.set(node, Object.freeze({
      kind: "nullish-comparison",
      left,
      right,
      outcome: Object.freeze({ kind: "constant", value: equality ? equal : !equal }),
    }));
    return;
  }
  const nullish = leftNullish ?? rightNullish!;
  const valueType = leftNullish === undefined ? leftType : rightType;
  const operand: "left" | "right" = leftNullish === undefined ? "left" : "right";
  if (valueType.kind === "optional") {
    const matchesAbsent = !strict || nullish.kind === "undefined";
    input.typeTestSelections.set(node, Object.freeze({
      kind: "nullish-comparison",
      left,
      right,
      outcome: matchesAbsent
        ? Object.freeze({ kind: "optional-absence", operand, equal: equality })
        : Object.freeze({ kind: "constant", value: inequality }),
    }));
    return;
  }
  if (valueType.kind === "union") {
    const testedTypes = valueType.members.filter((member): member is Extract<MojoTargetTypeRef, {
      readonly kind: "null" | "undefined";
    }> => (member.kind === "null" || member.kind === "undefined") &&
      (!strict || member.kind === nullish.kind));
    input.typeTestSelections.set(node, Object.freeze({
      kind: "nullish-comparison",
      left,
      right,
      outcome: testedTypes.length === 0
        ? Object.freeze({ kind: "constant", value: inequality })
        : Object.freeze({
            kind: "union-membership",
            operand,
            testedTypes: Object.freeze(testedTypes),
            equal: equality,
          }),
    }));
    return;
  }
  if (valueType.kind !== "dynamic") {
    input.typeTestSelections.set(node, Object.freeze({
      kind: "nullish-comparison",
      left,
      right,
      outcome: Object.freeze({ kind: "constant", value: inequality }),
    }));
  }
}

function exactNullishTarget(
  type: MojoTargetTypeRef,
): Extract<MojoTargetTypeRef, { readonly kind: "null" | "undefined" }> | undefined {
  return type.kind === "null" || type.kind === "undefined" ? type : undefined;
}

function selectedProjectTypeTestMember(
  sourceType: MojoTargetTypeRef,
  projectTypeId: string,
): MojoTargetTypeRef | undefined {
  const candidates = sourceType.kind === "optional"
    ? [sourceType.value]
    : sourceType.kind === "union"
      ? sourceType.members
      : [sourceType];
  const matching = candidates.filter((candidate) =>
    candidate.kind === "target-named" && candidate.id === projectTypeId);
  return matching.length === 1 ? matching[0] : undefined;
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
  const selectedReceiverType = resolve(selected.receiver.type);
  const structuralReceiverType = input.expressionTypes.get(selected.receiver.expression) ??
    selectedReceiverType;
  const structural = analyzeMojoStructuralProperty({
    source: selected,
    receiverType: structuralReceiverType,
    structuralObjects: input.structuralObjects,
    semantics,
  });
  const project = structural.kind === "not-structural-field"
    ? analyzeMojoProjectProperty(
    selected,
    input.fieldByDeclaration,
    selectedReceiverType,
    Object.freeze([
      ...semantics.facts.selectedSubjects(selected.selectedSymbol, selected.selectedDeclaration),
      ...semantics.facts.selectedSubjects(selected.sourceSymbol, selected.sourceDeclaration),
    ]),
    input.source.ast,
  ) : structural;
  const property = project.kind === "not-project-field"
    ? analyzeMojoProviderProperty(selected, {
        source: input.source,
        providerSemantics: input.providerSemantics,
        sourceProfiles: input.sourceProfiles,
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
    sourceProfiles: input.sourceProfiles,
    conversions: input.conversions,
    expressionTypes: input.expressionTypes,
    projectPropertyByDeclaration: input.fieldByDeclaration,
    resolveType(type) {
      return resolveType(type, undefined, input, semantics);
    },
  });
  if (element.kind === "unsupported") {
    input.diagnostics.push(diagnostic(element.code, element.reason, node));
  } else {
    input.elementSelections.set(node, element.selection);
    input.expressionTypes.set(node, element.expressionType);
    if (element.valueRefinement !== undefined) {
      input.valueRefinements.set(node, element.valueRefinement);
    }
  }
}
