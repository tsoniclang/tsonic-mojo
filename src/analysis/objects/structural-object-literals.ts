import type { Node, Symbol, TypePropertyInfo } from "@tsonic/tsts";
import { ObjectLiteralProperty_Value } from "@tsonic/target-api/source";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import type { MojoObjectLiteralSelection } from "../program/model.js";

export type MojoStructuralObjectLiteralAnalysis =
  | {
      readonly kind: "resolved";
      readonly selection: Extract<MojoObjectLiteralSelection, { readonly kind: "structural" }>;
    }
  | { readonly kind: "not-structural" }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string; readonly node: Node };

export function analyzeMojoStructuralObjectLiteral(input: {
  readonly source: TargetSourceProgram;
  readonly expression: Node;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly resolveType: (type: import("@tsonic/tsts").Type) => MojoTargetTypeRef | undefined;
}): MojoStructuralObjectLiteralAnalysis {
  const { ast } = input.source;
  const existingType = input.expressionTypes.get(input.expression);
  if (!ast.is.IsObjectLiteralExpression(input.expression) ||
    existingType !== undefined && existingType.kind !== "dynamic") {
    return Object.freeze({ kind: "not-structural" });
  }
  const semantics = input.source.semantics.forNode(input.expression);
  const sourceType = semantics.types.expressionType(input.expression);
  if (sourceType === undefined) {
    return unsupported(
      "MOJO_STRUCTURAL_OBJECT_SOURCE_TYPE_MISSING",
      "A structural object literal requires one exact checked source type.",
      input.expression,
    );
  }
  const properties = semantics.types.propertyInfos(sourceType);
  const elements = ast.properties(input.expression);
  if (elements.some((element) => element === undefined)) {
    return unsupported(
      "MOJO_STRUCTURAL_OBJECT_ELEMENT_MISSING",
      "A structural object literal contains an undefined source element.",
      input.expression,
    );
  }
  const selectedFields: {
    readonly element: Node;
    readonly value: Node;
    readonly field: import("../bindings/structural-objects.js").MojoStructuralObjectField;
  }[] = [];
  for (const element of elements as readonly Node[]) {
    if (!ast.is.IsPropertyAssignment(element) && !ast.is.IsShorthandPropertyAssignment(element)) {
      return Object.freeze({ kind: "not-structural" });
    }
    const value = ObjectLiteralProperty_Value(ast, element);
    const property = uniqueDeclaredProperty(properties, element, semantics);
    const selected = semantics.operations.objectLiteralElement(element);
    const expectedKind = ast.is.IsPropertyAssignment(element) ? "property" : "shorthand";
    if (value === undefined || property === undefined ||
      selected !== undefined && (selected.objectLiteral !== input.expression ||
        selected.element !== element || selected.elementKind !== expectedKind ||
        selected.sourceElementSymbol !== undefined &&
          !symbolsAgree(property.symbol, selected.sourceElementSymbol, semantics))) {
      return unsupported(
        "MOJO_STRUCTURAL_OBJECT_ELEMENT_EVIDENCE_MISSING",
        "A structural object field requires one exact checked property declaration identity.",
        element,
      );
    }
    const propertyType = semantics.types.typeOfSymbol(property.symbol);
    const fieldType = input.expressionTypes.get(value) ??
      (propertyType === undefined ? undefined : input.resolveType(propertyType));
    if (fieldType === undefined) {
      return unsupported(
        "MOJO_STRUCTURAL_OBJECT_FIELD_NOT_CLOSED",
        "A structural object field requires one exact source identity and Mojo carrier.",
        element,
      );
    }
    const declarations = semantics.declarations.symbolDeclarations(property.symbol);
    if (declarations.length === 0) {
      return unsupported(
        "MOJO_STRUCTURAL_OBJECT_FIELD_DECLARATION_MISSING",
        `Structural object field '${property.name}' has no exact source declaration identity.`,
        element,
      );
    }
    selectedFields.push(Object.freeze({
      element,
      value,
      field: Object.freeze({
        sourceName: property.name,
        sourceSymbol: property.symbol,
        sourceRootSymbols: Object.freeze([...property.rootSymbols]),
        sourceDeclarations: Object.freeze([...declarations]),
        type: property.optional && fieldType.kind !== "optional"
          ? Object.freeze({ kind: "optional" as const, value: fieldType })
          : fieldType,
        optional: property.optional,
        readonly: property.readonly,
      }),
    }));
  }
  if (selectedFields.length !== properties.length ||
    new Set(selectedFields.map(({ field }) => field.sourceName)).size !== selectedFields.length) {
    return unsupported(
      "MOJO_STRUCTURAL_OBJECT_FIELD_INVENTORY_INCOMPLETE",
      "Authored structural object fields do not form the complete exact checked property inventory.",
      input.expression,
    );
  }
  const definition = input.structuralObjects.define(
    input.expression,
    selectedFields.map(({ field }) => field),
  );
  if (definition === undefined) {
    return unsupported(
      "MOJO_STRUCTURAL_OBJECT_DEFINITION_CONFLICT",
      "The exact structural object occurrence acquired incompatible field definitions.",
      input.expression,
    );
  }
  return Object.freeze({
    kind: "resolved",
    selection: Object.freeze({
      kind: "structural",
      definition,
      fields: Object.freeze(selectedFields.map((entry, storageIndex) => Object.freeze({
        ...entry,
        storageIndex,
      }))),
    }),
  });
}

function uniqueDeclaredProperty(
  properties: readonly TypePropertyInfo[],
  element: Node,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
): TypePropertyInfo | undefined {
  const matches = properties.filter((property) =>
    [property.symbol, ...property.rootSymbols].some((symbol) =>
      semantics.declarations.symbolDeclarations(symbol).includes(element)));
  return matches.length === 1 ? matches[0] : undefined;
}

function symbolsAgree(
  left: Symbol,
  right: Symbol,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
): boolean {
  const leftSymbols = new Set([left, ...semantics.declarations.rootSymbols(left)]);
  return [right, ...semantics.declarations.rootSymbols(right)].some((symbol) =>
    leftSymbols.has(symbol));
}

function unsupported(
  code: string,
  reason: string,
  node: Node,
): Extract<MojoStructuralObjectLiteralAnalysis, { readonly kind: "unsupported" }> {
  return Object.freeze({ kind: "unsupported", code, reason, node });
}
