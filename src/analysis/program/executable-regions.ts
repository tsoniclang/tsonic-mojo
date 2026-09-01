import type { Node, SourceFile, Type } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
  Node_Initializer,
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
import { analyzeMojoElementAccess } from "../operations/elements.js";
import { analyzeMojoIteration } from "../operations/iterations.js";
import { analyzeMojoBindingPattern } from "../bindings/patterns.js";
import {
  analyzeMojoProjectProperty,
  analyzeMojoProviderProperty,
} from "../operations/properties.js";
import { analyzeMojoProviderValue } from "../operations/values.js";
import { analyzeMojoObjectLiteral } from "../objects/object-literals.js";
import { analyzeMojoProviderRecordLiteral } from "../objects/provider-records.js";
import type { MojoProjectTypeCatalog } from "../../target-model/types/project.js";
import type { MojoSourceProfileRegistry } from "../../policy/types/source-profile.js";
import { providerCallRequiresRaisingConversion } from "./effects.js";
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
  MojoTypeTestSelection,
  MojoValueRefinementSelection,
  MojoValueSelection,
} from "./model.js";
import { walkSourceTree, walkSourceTreePostOrder } from "./traversal.js";
import type { MojoSourceModuleCatalog } from "../source-modules/model.js";
import { expectedExpressionType } from "./expected-types.js";
import {
  declaredOrInitializerType,
  descendWithinExecutableRegion,
  isRuntimeValueOccurrence,
  providerValueReferenceRole,
  resolveExecutableRegionType as resolveType,
  targetTypeDiagnostic as typeDiagnostic,
} from "./executable-region-support.js";

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
  readonly valueRefinements: WeakMap<Node, MojoValueRefinementSelection>;
  readonly typeTestSelections: WeakMap<Node, MojoTypeTestSelection>;
  readonly objectLiteralSelections: WeakMap<Node, MojoObjectLiteralSelection>;
  readonly bindingPatternSelections: WeakMap<Node, MojoBindingPatternSelection>;
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
  const objectLiteralNodes: Node[] = [];
  const callableExpressionNodes: Node[] = [];
  const bindingPatternDeclarations: Node[] = [];
  walkSourceTree(root, ast, (node): void => {
    if (ast.is.IsVariableDeclaration(node)) {
      const authoredType = ast.typeNode(node);
      const initializer = Node_Initializer(ast, node);
      const resolved = authoredType === undefined && initializer !== undefined
        ? resolveInferredBindingCarrier(initializer, input, semantics)
        : resolveType(
            declaredOrInitializerType(node, semantics, ast),
            authoredType,
            input,
            semantics,
          );
      if (resolved === undefined) {
        input.diagnostics.push(typeDiagnostic(node, "the selected declaration has no closed Mojo carrier"));
      } else {
        input.bindingTypes.set(node, resolved);
      }
      const name = ast.name(node);
      if (name !== undefined &&
        (ast.is.IsArrayBindingPattern(name) || ast.is.IsObjectBindingPattern(name))) {
        bindingPatternDeclarations.push(node);
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
    if (ast.is.IsBinaryExpression(node) &&
      ast.operatorKindName(node) === "KindInstanceOfKeyword") {
      analyzeTypeTest(node, input);
    }
    if (ast.is.IsAsExpression(node) || ast.is.IsTypeAssertion(node) ||
      ast.is.IsNonNullExpression(node)) {
      analyzeErasedValueRefinement(node, input, semantics);
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
      if (candidate?.kind !== "target-named") {
        pendingObjects.delete(node);
        continue;
      }
      const selection = input.interfaceByTypeId.has(candidate.id)
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
        : analyzeMojoProviderRecordLiteral({
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
          });
      pendingObjects.delete(node);
      if (selection !== undefined) {
        input.objectLiteralSelections.set(node, selection);
        progressed = true;
      }
    }
  }

  for (const declaration of bindingPatternDeclarations) {
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
    const selection = analyzeMojoBindingPattern({
      ast,
      declaration,
      initializer,
      sourceType,
      bindingNames: input.bindingNames,
      bindingTypes: input.bindingTypes,
      classByTypeId: input.classByTypeId,
      interfaceByTypeId: input.interfaceByTypeId,
      diagnostics: input.diagnostics,
    });
    if (selection !== undefined) {
      input.bindingTypes.set(declaration, sourceType);
      input.bindingPatternSelections.set(declaration, selection);
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
  if (analyzed.selection.kind === "project" || analyzed.selection.kind === "callable" ||
    analyzed.selection.kind === "typed-location") {
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
  const selectedOccurrenceType = referencedType === undefined
    ? undefined
    : analyzeReferencedValueRefinement(node, referencedType, input, semantics);
  const erasedCarrier = isErasedValueWrapper(node, ast)
    ? resolveErasedExpressionCarrier(node, input, semantics)
    : undefined;
  const resolved = selectedOccurrenceType ?? referencedType ?? erasedCarrier ?? contextualExpected ??
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

function analyzeReferencedValueRefinement(
  node: Node,
  declaredTargetType: MojoTargetTypeRef,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const selected = input.source.semantics.selectValueTypeRefinement(node);
  if (selected.kind !== "resolved" || selected.refinement.kind !== "members" ||
    selected.refinement.types.length !== 1) return undefined;
  const selectedTargetType = resolveType(
    selected.refinement.types[0],
    undefined,
    input,
    semantics,
  );
  if (selectedTargetType === undefined) return undefined;
  const refinement = classifyValueRefinement(declaredTargetType, selectedTargetType);
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
  if (sourceRefinement.kind !== "members" || sourceRefinement.types.length !== 1) return;
  const refinement = classifyValueRefinement(sourceTargetType, selectedTargetType);
  if (refinement !== undefined) input.valueRefinements.set(node, refinement);
}

function resolveInferredBindingCarrier(
  initializer: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
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
  if (classifyValueRefinement(sourceCarrier, selectedCarrier) !== undefined) return selectedCarrier;
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

function classifyValueRefinement(
  sourceType: MojoTargetTypeRef,
  resultType: MojoTargetTypeRef,
): MojoValueRefinementSelection | undefined {
  if (sourceType.kind === "optional" &&
    mojoTargetTypeEquals(sourceType.value, resultType)) {
    return Object.freeze({ kind: "optional-present", sourceType, resultType });
  }
  if (sourceType.kind === "union" &&
    sourceType.members.some((member) => mojoTargetTypeEquals(member, resultType))) {
    return Object.freeze({ kind: "union-member", sourceType, resultType });
  }
  return undefined;
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
  const project = analyzeMojoProjectProperty(
    selected,
    input.fieldByDeclaration,
    resolve(selected.receiver.type),
  );
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
