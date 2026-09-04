import type { Node, SourceFile } from "@tsonic/tsts";
import {
  CatchClause_VariableDeclaration,
  Node_Expression,
  Node_Initializer,
  ObjectLiteralProperty_Value,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import { mojoAnalysisDiagnostic as diagnostic } from "../diagnostics.js";
import { analyzeMojoIteration } from "../operations/iterations.js";
import {
  analyzeMojoBindingProjection,
} from "../bindings/patterns.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import { analyzeMojoObjectLiteral } from "../objects/object-literals.js";
import { analyzeMojoResourceManagement } from "../resources/management.js";
import { analyzeMojoProviderRecordLiteral } from "../objects/provider-records.js";
import type {
  MojoProjectTypeCatalog,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { inferMojoExpressionType, isMojoExpressionNode } from "./expression-types.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedClassOwner,
  MojoBindingProjectionPlan,
  MojoBindingPatternSelection,
  MojoAnalyzedFunction,
  MojoAnalyzedProjectProperty,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoNullishCoalescingSelection,
  MojoObjectLiteralSelection,
  MojoPropertySelection,
  MojoResourceManagementSelection,
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";
import { walkSourceTree, walkSourceTreePostOrder } from "../../source/syntax/traversal.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import {
  analyzeExecutableRegionProviderValues,
  declaredOrInitializerType,
  descendWithinExecutableRegion,
  executableRegionErrorTypes,
  isRuntimeValueOccurrence,
  resolveExecutableRegionType as resolveType,
  targetTypeDiagnostic as typeDiagnostic,
} from "./executable-region-support.js";
import { mergeMojoErrorTypes, mojoOperationErrorTypes } from "./effects.js";
import { classifyMojoValueRefinement } from "../refinements/value.js";
import { expectedExpressionType } from "./expected-types.js";
import {
  analyzeErasedValueRefinement,
  analyzeExpressionCarrier,
  analyzeNullishComparison,
  analyzeReferencedValueRefinement,
  analyzeTypeTest,
  containsProjectInterface,
  resolveInferredBindingCarrier,
  selectedOperationReceiverType,
} from "./executable-region-carriers.js";
import {
  analyzeNullishCoalescing,
  isMojoIterationBindingDeclaration,
  publishBindingPatternCarriers,
  selectReturnValueTransfer,
} from "./executable-region-flow.js";
import { analyzeCall, analyzeElement, analyzeProperty } from "./executable-region-operations.js";
import type { MojoLifecycleAnalysis } from "../lifecycle/model.js";
import type { MojoValueOwnership } from "../../target-model/lifecycle/model.js";

export interface MojoExecutableRegionAnalysisInput {
  readonly root: Node;
  readonly sourceFile: SourceFile;
  readonly owner?: MojoAnalyzedClassOwner;
  readonly rootExpectedType?: MojoTargetTypeRef;
  readonly returnType?: MojoTargetTypeRef;
  readonly source: TargetSourceProgram;
  readonly providerSemantics: MojoProviderSemantics;
  readonly projectTypes: MojoProjectTypeCatalog;
  readonly projectRelationships: MojoProjectTypeRelationships;
  readonly lifecycle: MojoLifecycleAnalysis;
  readonly valueOwnership: (expression: Node) => MojoValueOwnership;
  readonly sourceProfiles: MojoSourceProfileRegistry;
  readonly modules: MojoSourceModuleCatalog;
  readonly jsEnabled: boolean;
  readonly sourceCallableErrorType?: MojoTargetTypeRef;
  readonly diagnostics: TargetDiagnostic[];
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingSourceFiles: WeakMap<Node, SourceFile>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly callNodes: Set<Node>;
  readonly callDependencies: WeakMap<Node, Node>;
  readonly propertySelections: WeakMap<Node, MojoPropertySelection>;
  readonly propertyNodes: Set<Node>;
  readonly elementSelections: WeakMap<Node, MojoElementSelection>;
  readonly iterationSelections: WeakMap<Node, MojoIterationSelection>;
  readonly resourceManagementSelections: WeakMap<Node, MojoResourceManagementSelection>;
  readonly resourceDeclarations: Set<Node>;
  readonly valueSelections: WeakMap<Node, MojoValueSelection>;
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly typeTestSelections: WeakMap<Node, MojoTypeTestSelection>;
  readonly nullishCoalescingSelections: WeakMap<Node, MojoNullishCoalescingSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly objectLiteralNodes: Set<Node>;
  readonly templateExpressionNodes: Set<Node>;
  readonly bindingPatternSelections: WeakMap<Node, MojoBindingPatternSelection>;
  readonly bindingProjections: WeakMap<Node, MojoBindingProjectionPlan>;
  readonly returnValueTransfers: WeakSet<Node>;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly conversions: MojoConversionIndex;
  readonly functionByDeclaration: WeakMap<Node, MojoAnalyzedFunction>;
  readonly callableByDeclaration: WeakMap<Node, import("./model.js").MojoAnalyzedProjectCallable>;
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
    options?: {
      readonly selectedType?: import("@tsonic/tsts").Type;
      readonly kind?: import("./model.js").MojoAnalyzedCallableKind;
      readonly name?: string;
      readonly allowAsynchronous?: boolean;
      readonly captureSelf?: boolean;
    },
  ) => MojoCallableExpressionSelection | undefined;
}

export type MojoExecutableRegionAnalysisEnvironment = Omit<
  MojoExecutableRegionAnalysisInput,
  "root" | "sourceFile" | "owner" | "rootExpectedType" | "returnType"
>;

export function analyzeMojoExecutableBindingProjection(
  declaration: Node,
  sourceType: MojoTargetTypeRef,
  sourceSemanticType: import("@tsonic/tsts").Type | undefined,
  sourceFile: SourceFile,
  input: MojoExecutableRegionAnalysisEnvironment,
): MojoBindingProjectionPlan | undefined {
  const { ast } = input.source;
  const pattern = ast.name(declaration);
  if (pattern === undefined || (!ast.is.IsArrayBindingPattern(pattern) &&
    !ast.is.IsObjectBindingPattern(pattern))) return undefined;
  const semantics = input.source.semantics.forFile(sourceFile);
  const executableInput: MojoExecutableRegionAnalysisInput = {
    ...input,
    root: declaration,
    sourceFile,
  };
  const projection = analyzeMojoBindingProjection({
    ast,
    declaration,
    pattern,
    sourceType,
    sourceSemanticType,
    semantics,
    resolveType(type) {
      return resolveType(type, undefined, executableInput, semantics);
    },
    expressionTypes: input.expressionTypes,
    conversions: input.conversions,
    bindingNames: input.bindingNames,
    bindingTypes: input.bindingTypes,
    classByTypeId: input.classByTypeId,
    interfaceByTypeId: input.interfaceByTypeId,
    projectRelationships: input.projectRelationships,
    structuralObjects: input.structuralObjects,
    diagnostics: input.diagnostics,
  });
  if (projection === undefined) return undefined;
  input.bindingTypes.set(declaration, sourceType);
  input.bindingProjections.set(declaration, projection);
  publishBindingPatternCarriers(projection.elements, input);
  return projection;
}

export interface MojoExecutableRegionAnalysis {
  readonly dependencies: ReadonlySet<Node>;
  readonly errorTypes: readonly MojoTargetTypeRef[];
  readonly raises: boolean;
}

export function sealMojoCatchBindingCarrier(
  catchClause: Node,
  catchBlock: Node,
  errorType: MojoTargetTypeRef,
  input: MojoExecutableRegionAnalysisEnvironment,
): void {
  const declaration = CatchClause_VariableDeclaration(input.source.ast, catchClause);
  if (declaration === undefined) return;
  const sourceFile = input.source.ast.getSourceFile(catchClause);
  if (sourceFile === undefined) return;
  input.bindingTypes.set(declaration, errorType);
  input.bindingSourceFiles.set(declaration, sourceFile);
  const semantics = input.source.semantics.forFile(sourceFile);
  for (const use of input.source.navigation.declarationUses(declaration)) {
    if (use.kind === "type-only" || use.kind === "source-linkage") continue;
    input.valueRefinements.delete(use.reference);
    const environment = { ...input, root: catchBlock, sourceFile };
    const selectedReceiverType = selectedOperationReceiverType(use.reference, input);
    const exactRefinement = selectedReceiverType === undefined
      ? undefined
      : classifyMojoValueRefinement(
          errorType,
          selectedReceiverType,
          input.projectRelationships,
          input.modules,
        );
    if (exactRefinement !== undefined) {
      input.valueRefinements.set(use.reference, exactRefinement);
    }
    const refined = exactRefinement?.resultType ?? analyzeReferencedValueRefinement(
      use.reference,
      errorType,
      environment,
      semantics,
    );
    input.expressionTypes.set(use.reference, refined ?? errorType);
  }
  walkSourceTreePostOrder(catchBlock, input.source.ast, (node): void => {
    if (input.source.ast.is.IsBinaryExpression(node) &&
      input.source.ast.operatorKindName(node) === "KindInstanceOfKeyword") {
      analyzeTypeTest(node, { ...input, root: catchBlock, sourceFile });
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, input.source.ast));
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
      if (bindingPattern && !isMojoIterationBindingDeclaration(node, ast)) {
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
    if (!isContextualObjectCallable(expression, source, semantics)) {
      input.analyzeCallableExpression(expression, sourceFile, input.owner);
    }
  }

  const pendingBindingPatterns = new Set(bindingPatternDeclarations);
  const analyzeBindingPatternDeclaration = (
    declaration: Node,
    sourceType: MojoTargetTypeRef | undefined,
  ): void => {
    const initializer = Node_Initializer(ast, declaration);
    if (initializer === undefined || sourceType === undefined) return;
    const projection = analyzeMojoExecutableBindingProjection(
      declaration,
      sourceType,
      semantics.types.expressionType(initializer),
      input.sourceFile,
      input,
    );
    if (projection === undefined) return;
    const selection = Object.freeze({
      ...projection,
      initializer,
      sourceReuse: ast.is.IsIdentifier(initializer) &&
        input.source.navigation.sourceReferenceFor(initializer)?.project === true
        ? "direct" as const
        : "stabilized" as const,
    });
    input.bindingPatternSelections.set(declaration, selection);
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
      if (ast.operatorKindName(node) === "KindQuestionQuestionToken") {
        analyzeNullishCoalescing(node, input);
      } else if (ast.operatorKindName(node) === "KindInstanceOfKeyword") {
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
      input.templateExpressionNodes.add(node);
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
      const projectInterfaceCandidate = candidate !== undefined &&
        containsProjectInterface(candidate, input.interfaceByTypeId);
      if (candidate === undefined ||
        (candidate.kind !== "target-named" && candidate.kind !== "optional" &&
          candidate.kind !== "union")) {
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
            projectRelationships: input.projectRelationships,
            fieldByDeclaration: input.fieldByDeclaration,
            callableByDeclaration: input.callableByDeclaration,
            analyzeCallable(element, selectedType, kind, name, owner) {
              return input.analyzeCallableExpression(
                element,
                sourceFile,
                owner,
                {
                  selectedType,
                  kind,
                  name,
                  allowAsynchronous: true,
                  captureSelf: false,
                },
              );
            },
            analyzeCallableValue(expression, selectedType) {
              return input.analyzeCallableExpression(
                expression,
                sourceFile,
                input.owner,
                { selectedType },
              );
            },
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
        input.objectLiteralNodes.add(node);
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
      sourceTypesIdentical(left, right) {
        return semantics.types.isIdentical(left, right);
      },
      analyzeBindingProjection(declaration, sourceType, sourceSemanticType) {
        return analyzeMojoExecutableBindingProjection(
          declaration,
          sourceType,
          sourceSemanticType,
          input.sourceFile,
          input,
        );
      },
    });
    if (iteration.kind === "unsupported") {
      input.diagnostics.push(diagnostic(iteration.code, iteration.reason, node));
    } else {
      input.iterationSelections.set(node, iteration.selection);
    }
  }
  const resourceErrorTypes: MojoTargetTypeRef[] = [];
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
      callableByDeclaration: input.callableByDeclaration,
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
        resourceErrorTypes.push(...mojoOperationErrorTypes(alternative.disposal.operation));
      }
    }
  }
  analyzeExecutableRegionProviderValues(root, input);
  const errorTypes = mergeMojoErrorTypes(
    resourceErrorTypes,
    executableRegionErrorTypes(root, input),
  );
  return Object.freeze({
    dependencies,
    errorTypes,
    raises: errorTypes.length > 0,
  });
}

function isContextualObjectCallable(
  expression: Node,
  source: TargetSourceProgram,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): boolean {
  const { ast } = source;
  let value = expression;
  let parent = ast.parent(value);
  while (parent !== undefined &&
    (ast.is.IsParenthesizedExpression(parent) || ast.is.IsAsExpression(parent) ||
      ast.is.IsTypeAssertion(parent) || ast.is.IsNonNullExpression(parent) ||
      ast.is.IsSatisfiesExpression(parent)) && Node_Expression(ast, parent) === value) {
    value = parent;
    parent = ast.parent(value);
  }
  if (parent === undefined || !ast.is.IsPropertyAssignment(parent) ||
    ObjectLiteralProperty_Value(ast, parent) !== value) return false;
  const objectLiteral = ast.parent(parent);
  const selected = semantics.operations.objectLiteralElement(parent);
  return objectLiteral !== undefined && ast.is.IsObjectLiteralExpression(objectLiteral) &&
    selected !== undefined && selected.objectLiteral === objectLiteral && selected.element === parent;
}
