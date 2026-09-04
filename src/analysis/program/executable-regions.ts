import type { Node, SourceFile } from "@tsonic/tsts";
import {
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
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import { analyzeMojoObjectLiteral } from "../objects/object-literals.js";
import { analyzeMojoArrayLiteral } from "../aggregates/array-literals.js";
import { analyzeMojoProviderRecordLiteral } from "../objects/provider-records.js";
import { analyzeMojoStructuralObjectLiteral } from "../objects/structural-object-literals.js";
import type {
  MojoProjectTypeCatalog,
  MojoProjectTypeRelationships,
} from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { inferMojoExpressionType, isMojoExpressionNode } from "./expression-types.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedClassOwner,
  MojoArrayLiteralSelection,
  MojoBindingProjectionPlan,
  MojoBindingPatternSelection,
  MojoAnalyzedFunction,
  MojoAnalyzedProjectProperty,
  MojoCallSelection,
  MojoCallableExpressionSelection,
  MojoElementSelection,
  MojoIterationSelection,
  MojoIntrinsicExpressionSelection,
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
import { mergeMojoErrorTypes } from "./effects.js";
import {
  expectedExpressionType,
  selectedSourceCallArgumentExpectedType,
} from "./expected-types.js";
import {
  analyzeErasedValueRefinement,
  analyzeExpressionCarrier,
  analyzeNullishComparison,
  analyzeTypeTest,
  containsProjectInterface,
  resolveInferredBindingCarrier,
} from "./executable-region-carriers.js";
import {
  analyzeNullishCoalescing,
  isMojoIterationBindingDeclaration,
  selectReturnValueTransfer,
} from "./executable-region-flow.js";
import { analyzeCall, analyzeElement, analyzeProperty } from "./executable-region-operations.js";
import { analyzeMojoIntrinsicExpression } from "../operations/intrinsic-expressions.js";
import type { MojoLifecycleAnalysis } from "../lifecycle/model.js";
import type { MojoValueOwnership } from "../../target-model/lifecycle/model.js";
import { analyzeMojoExecutableBindingProjection } from "./executable-region-bindings.js";
import { analyzeMojoIterationAndResources } from "./executable-region-iterations.js";

export {
  analyzeMojoExecutableBindingProjection,
  sealMojoCatchBindingCarrier,
} from "./executable-region-bindings.js";

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
  readonly executableRegionRoots: Map<Node, "expression" | "statement" | "declaration">;
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
  readonly intrinsicExpressionSelections: WeakMap<Node, MojoIntrinsicExpressionSelection>;
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly typeTestSelections: WeakMap<Node, MojoTypeTestSelection>;
  readonly nullishCoalescingSelections: WeakMap<Node, MojoNullishCoalescingSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly arrayLiteralSelections: WeakMap<Node, MojoArrayLiteralSelection>;
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

export interface MojoExecutableRegionAnalysis {
  readonly dependencies: ReadonlySet<Node>;
  readonly errorTypes: readonly MojoTargetTypeRef[];
  readonly raises: boolean;
}

export function analyzeMojoExecutableRegion(
  input: MojoExecutableRegionAnalysisInput,
): MojoExecutableRegionAnalysis {
  const { source, root, sourceFile } = input;
  const { ast } = source;
  input.executableRegionRoots.set(root, classifyExecutableRegionRoot(root, ast));
  const semantics = source.semantics.forFile(sourceFile);
  const dependencies = new Set<Node>();
  const iterationNodes: Node[] = [];
  const resourceDeclarations: Node[] = [];
  const objectLiteralNodes: Node[] = [];
  const callableExpressionNodes: Node[] = [];
  const bindingPatternDeclarations: Node[] = [];
  const pendingInferredBindings = new Set<Node>();
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
      if (resolved === undefined && !bindingPattern) pendingInferredBindings.add(node);
      else if (resolved !== undefined) input.bindingTypes.set(node, resolved);
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

  walkSourceTreePostOrder(root, ast, (node): void => {
    if (isMojoExpressionNode(node, ast)) {
      const inferred = inferMojoExpressionType(node, ast, input.expressionTypes);
      if (inferred !== undefined) input.expressionTypes.set(node, inferred);
    }
    if (!ast.is.IsObjectLiteralExpression(node) || input.objectLiteralSelections.has(node)) return;
    const expectedType = expectedExpressionType(node, input) ??
      selectedSourceCallArgumentExpectedType(
        node,
        input,
        semantics,
        (type) => resolveType(type, undefined, input, semantics),
      );
    const contextual = semantics.types.contextualValueSelection(node);
    const contextualType = contextual.kind === "selected"
      ? resolveType(contextual.type, undefined, input, semantics)
      : undefined;
    const reservedType = expectedType ?? contextualType;
    if (reservedType !== undefined && (
      reservedType.kind === "target-named" || reservedType.kind === "optional" ||
      reservedType.kind === "union"
    )) return;
    const selected = analyzeMojoStructuralObjectLiteral({
      source,
      expression: node,
      expressionTypes: input.expressionTypes,
      structuralObjects: input.structuralObjects,
      resolveType(type) {
        return resolveType(type, undefined, input, semantics);
      },
    });
    if (selected.kind === "resolved") {
      input.objectLiteralSelections.set(node, selected.selection);
      input.objectLiteralNodes.add(node);
      input.expressionTypes.set(node, selected.selection.definition.type);
    } else if (selected.kind === "unsupported") {
      input.diagnostics.push(diagnostic(selected.code, selected.reason, selected.node));
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, ast));

  const publishPendingBinding = (declaration: Node): boolean => {
    const initializer = Node_Initializer(ast, declaration);
    const selected = initializer === undefined
      ? undefined
      : input.expressionTypes.get(initializer) ?? resolveInferredBindingCarrier(
          initializer,
          input,
          semantics,
        );
    if (selected === undefined) return false;
    input.bindingTypes.set(declaration, selected);
    for (const use of source.navigation.declarationUses(declaration)) {
      if (use.kind !== "type-only" && use.kind !== "source-linkage") {
        input.expressionTypes.set(use.reference, selected);
      }
    }
    pendingInferredBindings.delete(declaration);
    return true;
  };
  for (const declaration of [...pendingInferredBindings]) {
    publishPendingBinding(declaration);
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
    if (ast.is.IsTypeOfExpression(node) || ast.is.IsVoidExpression(node)) {
      const intrinsic = analyzeMojoIntrinsicExpression(node, ast, input.expressionTypes);
      if (intrinsic.kind === "unsupported") {
        input.diagnostics.push(diagnostic(intrinsic.code, intrinsic.reason, node));
      } else if (intrinsic.kind === "resolved") {
        input.intrinsicExpressionSelections.set(node, intrinsic.selection);
        input.expressionTypes.set(node, intrinsic.selection.resultType);
      }
    }
    if (ast.kindName(node) === "KindTemplateExpression") {
      input.templateExpressionNodes.add(node);
    }
    if (!isMojoExpressionNode(node, ast) || !isRuntimeValueOccurrence(node, input)) return;
    const inferred = inferMojoExpressionType(node, ast, input.expressionTypes);
    if (inferred !== undefined) input.expressionTypes.set(node, inferred);
    const parent = ast.parent(node);
    if (parent !== undefined && pendingInferredBindings.has(parent) &&
      ast.is.IsVariableDeclaration(parent) && Node_Initializer(ast, parent) === node) {
      publishPendingBinding(parent);
    }
    if (ast.is.IsArrayLiteralExpression(node)) {
      const resultType = input.expressionTypes.get(node);
      if (resultType === undefined) {
        input.diagnostics.push(diagnostic(
          "MOJO_ARRAY_LITERAL_RESULT_NOT_CLOSED",
          "An array literal requires one exact sealed result carrier.",
          node,
        ));
      } else {
        const array = analyzeMojoArrayLiteral({
          ast,
          expression: node,
          resultType,
          expressionTypes: input.expressionTypes,
          conversions: input.conversions,
          projectRelationships: input.projectRelationships,
          lifecycle: input.lifecycle,
          valueOwnership: input.valueOwnership,
        });
        if (array.kind === "unsupported") {
          input.diagnostics.push(diagnostic(array.code, array.reason, array.node));
        } else {
          input.arrayLiteralSelections.set(node, array.selection);
        }
      }
    }
  }, (node, regionRoot) => descendWithinExecutableRegion(node, regionRoot, ast));

  for (const declaration of [...pendingInferredBindings]) {
    if (!publishPendingBinding(declaration)) {
      input.diagnostics.push(typeDiagnostic(
        declaration,
        "the selected declaration has no closed Mojo carrier",
      ));
    }
  }

  const pendingObjects = new Set(objectLiteralNodes);
  let progressed = true;
  while (pendingObjects.size !== 0 && progressed) {
    progressed = false;
    for (const node of pendingObjects) {
      if (input.objectLiteralSelections.has(node)) {
        pendingObjects.delete(node);
        continue;
      }
      const expectedType = expectedExpressionType(node, input) ??
        selectedSourceCallArgumentExpectedType(
          node,
          input,
          semantics,
          (type) => resolveType(type, undefined, input, semantics),
        );
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

  const diagnosedNodes = new Set(input.diagnostics.map(({ sourceNode }) => sourceNode));
  for (const node of objectLiteralNodes) {
    if (input.objectLiteralSelections.has(node) ||
      input.expressionTypes.get(node)?.kind === "dictionary" ||
      diagnosedNodes.has(node)) continue;
    input.diagnostics.push(diagnostic(
      "MOJO_OBJECT_LITERAL_SHAPE_UNSUPPORTED",
      "Object literal has no sealed dictionary, structural, provider-record, or project-interface representation.",
      node,
    ));
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

  const resourceErrorTypes = analyzeMojoIterationAndResources({
    iterationNodes,
    resourceDeclarations,
    dependencies,
    semantics,
    input,
  });
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

function classifyExecutableRegionRoot(
  root: Node,
  ast: TargetSourceProgram["ast"],
): "expression" | "statement" | "declaration" {
  if (ast.is.IsVariableDeclaration(root)) return "declaration";
  if (ast.is.IsBlock(root) || ast.is.IsReturnStatement(root) ||
    ast.is.IsExpressionStatement(root) || ast.is.IsThrowStatement(root) ||
    ast.is.IsVariableStatement(root) || ast.is.IsIfStatement(root) ||
    ast.is.IsWhileStatement(root) || ast.is.IsDoStatement(root) ||
    ast.is.IsForStatement(root) || ast.is.IsForOfStatement(root) ||
    ast.is.IsForInStatement(root) || ast.is.IsSwitchStatement(root) ||
    ast.is.IsTryStatement(root) || ast.is.IsBreakStatement(root) ||
    ast.is.IsContinueStatement(root) || ast.is.IsEmptyStatement(root) ||
    ast.is.IsDebuggerStatement(root) || ast.is.IsLabeledStatement(root)) {
    return "statement";
  }
  return "expression";
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
