import { pointerOperationFactKey, rawPointerOperationFactKey } from "@tsonic/tsts";
import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_Right,
  Node_Expression,
} from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { mojoLocationTargetType } from "../operations/typed-locations.js";
import { mojoRawPointerTargetType } from "../operations/raw-pointers.js";
import { classifyMojoValueRefinement } from "../refinements/value.js";
import { expectedExpressionType } from "./expected-types.js";
import { resolveExecutableRegionType as resolveType } from "./executable-region-support.js";
import type {
  MojoAnalyzedInterface,
  MojoCallSelection,
  MojoPropertySelection,
  MojoTypeTestSelection,
} from "./model.js";
import type {
  MojoExecutableRegionAnalysisEnvironment,
  MojoExecutableRegionAnalysisInput,
} from "./executable-regions.js";

export function selectedOperationReceiverType(
  reference: Node,
  input: MojoExecutableRegionAnalysisEnvironment,
): MojoTargetTypeRef | undefined {
  const { ast } = input.source;
  let current = reference;
  for (;;) {
    const parent = ast.parent(current);
    if (parent === undefined) return undefined;
    if (ast.is.IsPropertyAccessExpression(parent)) {
      const selection = input.propertySelections.get(parent);
      const selected = selection !== undefined && propertyReceiver(selection) === current
        ? propertyReceiverType(selection)
        : undefined;
      if (selected !== undefined) return selected;
      const call = ast.parent(parent);
      if (call !== undefined && (ast.is.IsCallExpression(call) || ast.is.IsNewExpression(call))) {
        const callSelection = input.callSelections.get(call);
        const receiver = callSelection === undefined ? undefined : callReceiver(callSelection);
        if (receiver?.node === current) return receiver.type;
      }
      return undefined;
    }
    if (ast.is.IsElementAccessExpression(parent)) {
      const selection = input.elementSelections.get(parent);
      if (selection?.receiver === current) {
        return selection.kind === "provider"
          ? selection.sourceReceiverType
          : selection.receiverType;
      }
      return undefined;
    }
    if (!isTransparentReceiverWrapper(parent, ast)) return undefined;
    current = parent;
  }
}

function propertyReceiver(selection: MojoPropertySelection): Node | undefined {
  switch (selection.kind) {
    case "project-field":
    case "project-index-property":
    case "structural-field":
    case "project-union-field":
    case "provider":
      return selection.receiver;
    case "project-static-field":
    case "project-enum-member":
    case "provider-constant":
    case "provider-static":
      return undefined;
  }
}

function propertyReceiverType(selection: MojoPropertySelection): MojoTargetTypeRef | undefined {
  switch (selection.kind) {
    case "project-field":
    case "project-index-property":
    case "structural-field":
    case "project-union-field":
      return selection.receiverType;
    case "provider":
      return selection.sourceReceiverType;
    case "project-static-field":
    case "project-enum-member":
    case "provider-constant":
    case "provider-static":
      return undefined;
  }
}

function callReceiver(selection: MojoCallSelection): {
  readonly node: Node;
  readonly type: MojoTargetTypeRef;
} | undefined {
  if (selection.kind === "project" && selection.target.kind === "method") {
    return Object.freeze({ node: selection.target.receiver, type: selection.target.receiverType });
  }
  if (selection.kind === "provider" && selection.receiver !== undefined &&
    selection.sourceReceiverType !== undefined) {
    return Object.freeze({ node: selection.receiver, type: selection.sourceReceiverType });
  }
  return undefined;
}

function isTransparentReceiverWrapper(node: Node, ast: AstReader): boolean {
  return ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsTypeAssertion(node) || ast.is.IsNonNullExpression(node);
}

export function analyzeExpressionCarrier(
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
  const contextualAggregate = ast.is.IsArrayLiteralExpression(node) ||
      ast.is.IsObjectLiteralExpression(node)
    ? resolveContextualAggregateCarrier(node, input, semantics)
    : undefined;
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
  const resolved = selectedOccurrenceType ?? referencedType ?? erasedCarrier ??
    contextualAggregate ?? semanticType ?? contextualExpected;
  if (resolved !== undefined) input.expressionTypes.set(node, resolved);
  if (ast.kindName(node) === "KindThisKeyword" && input.owner !== undefined) {
    input.bindingNames.set(node, "self");
    input.expressionTypes.set(node, input.owner.type);
  }
}

function resolveContextualAggregateCarrier(
  node: Node,
  input: MojoExecutableRegionAnalysisInput,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): MojoTargetTypeRef | undefined {
  const selected = semantics.types.contextualValueSelection(node);
  return selected.kind === "selected"
    ? resolveType(selected.type, undefined, input, semantics)
    : undefined;
}

export function containsProjectInterface(
  type: MojoTargetTypeRef,
  interfaces: ReadonlyMap<string, MojoAnalyzedInterface>,
): boolean {
  if (type.kind === "target-named") return interfaces.has(type.id);
  if (type.kind === "optional") return containsProjectInterface(type.value, interfaces);
  return type.kind === "union" && type.members.some((member) =>
    containsProjectInterface(member, interfaces));
}

export function analyzeReferencedValueRefinement(
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

export function analyzeErasedValueRefinement(
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

export function resolveInferredBindingCarrier(
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
  const exactExpressionType = input.expressionTypes.get(initializer);
  if (exactExpressionType !== undefined) return exactExpressionType;
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
  const selectedCarrier = resolveType(
    semantics.types.expressionType(node),
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

function isErasedValueWrapper(node: Node, ast: TargetSourceProgram["ast"]): boolean {
  return ast.is.IsParenthesizedExpression(node) || ast.is.IsAsExpression(node) ||
    ast.is.IsTypeAssertion(node) || ast.is.IsNonNullExpression(node) ||
    ast.is.IsSatisfiesExpression(node);
}

export function analyzeTypeTest(
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

export function analyzeNullishComparison(
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
