import type { AstReader, Node, Symbol, Type, TypePropertyInfo } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  BindingElement_IsRest,
  BindingElement_PropertyName,
  Node_Initializer,
} from "@tsonic/target-api/source";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { instantiateProjectFieldType } from "../operations/project-fields.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
  MojoBindingNormalization,
  MojoBindingPatternElementSelection,
  MojoBindingPatternSelection,
  MojoBindingValueProjection,
} from "../program/model.js";
import type { MojoStructuralObjectCatalog } from "./structural-objects.js";

type SourceSemantics = ReturnType<TargetSourceProgram["semantics"]["forFile"]>;

export interface MojoBindingPatternAnalysisInput {
  readonly ast: AstReader;
  readonly declaration: Node;
  readonly initializer: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly sourceSemanticType?: Type;
  readonly semantics: SourceSemantics;
  readonly resolveType: (type: Type) => MojoTargetTypeRef | undefined;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly conversions: MojoConversionIndex;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly interfaceByTypeId: ReadonlyMap<string, MojoAnalyzedInterface>;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly diagnostics: TargetDiagnostic[];
}

export function analyzeMojoBindingPattern(
  input: MojoBindingPatternAnalysisInput,
): MojoBindingPatternSelection | undefined {
  const pattern = input.ast.name(input.declaration);
  if (pattern === undefined ||
    (!input.ast.is.IsArrayBindingPattern(pattern) && !input.ast.is.IsObjectBindingPattern(pattern))) {
    return undefined;
  }
  const elements = analyzePatternElements(pattern, input.sourceType, input.sourceSemanticType, input);
  return elements === undefined
    ? undefined
    : Object.freeze({
        declaration: input.declaration,
        initializer: input.initializer,
        sourceType: input.sourceType,
        elements,
      });
}

function analyzePatternElements(
  pattern: Node,
  sourceType: MojoTargetTypeRef,
  sourceSemanticType: Type | undefined,
  input: MojoBindingPatternAnalysisInput,
): readonly MojoBindingPatternElementSelection[] | undefined {
  const array = input.ast.is.IsArrayBindingPattern(pattern);
  const object = input.ast.is.IsObjectBindingPattern(pattern);
  if (!array && !object) return undefined;
  const objectExtractedNames = object
    ? collectObjectExtractedNames(pattern, input.ast)
    : undefined;
  if (object && objectExtractedNames === undefined) {
    reject(input, "MOJO_BINDING_OBJECT_KEYS_NOT_CLOSED", "Object binding keys must be exact authored property names.", pattern);
    return undefined;
  }
  const selections: MojoBindingPatternElementSelection[] = [];
  for (const [index, element] of input.ast.elements(pattern).entries()) {
    if (element === undefined || input.ast.is.IsOmittedExpression(element)) continue;
    if (!input.ast.is.IsBindingElement(element)) {
      reject(input, "MOJO_BINDING_ELEMENT_UNSUPPORTED", "A binding pattern contains a non-binding element.", element);
      return undefined;
    }
    const nameNode = input.ast.name(element);
    if (array && nameNode === undefined) continue;
    if (nameNode === undefined) {
      reject(input, "MOJO_BINDING_NAME_MISSING", "A binding element has no exact target name.", element);
      return undefined;
    }
    const rest = BindingElement_IsRest(input.ast, element);
    const initializer = Node_Initializer(input.ast, element);
    if (rest && initializer !== undefined) {
      reject(input, "MOJO_BINDING_REST_DEFAULT_INVALID", "A rest binding cannot also carry a default initializer.", element);
      return undefined;
    }
    const projected = array
      ? projectArrayElement(
          sourceType,
          sourceSemanticType,
          index,
          rest,
          initializer !== undefined,
          input,
        )
      : projectObjectElement(
          sourceType,
          sourceSemanticType,
          element,
          nameNode,
          rest,
          objectExtractedNames!,
          input,
        );
    if (projected === undefined) {
      reject(
        input,
        "MOJO_BINDING_PROJECTION_UNSUPPORTED",
        "The exact source aggregate has no sealed Mojo projection for this binding element.",
        element,
      );
      return undefined;
    }
    const bindingType = projected.bindingType ??
      (initializer !== undefined && projected.type.kind === "optional"
        ? projected.type.value
        : projected.type);
    const normalization = selectNormalization(projected.type, bindingType, initializer !== undefined);
    if (normalization === undefined) {
      reject(
        input,
        "MOJO_BINDING_NORMALIZATION_UNPROVEN",
        "The checker-selected binding carrier cannot be normalized from its exact projected Mojo carrier.",
        element,
      );
      return undefined;
    }
    if (initializer !== undefined && normalization === "default-on-none") {
      const actual = input.expressionTypes.get(initializer) ??
        resolveSourceType(input.semantics.types.expressionType(initializer), input);
      if (actual === undefined) {
        reject(input, "MOJO_BINDING_DEFAULT_CARRIER_MISSING", "A binding default has no exact Mojo carrier.", initializer);
        return undefined;
      }
      const conversion = input.conversions.record(initializer, actual, bindingType);
      if (conversion.kind === "unsupported") {
        reject(input, "MOJO_BINDING_DEFAULT_CONVERSION_UNPROVEN", conversion.reason, initializer);
        return undefined;
      }
    }
    input.bindingTypes.set(element, bindingType);
    input.bindingTypes.set(nameNode, bindingType);
    const common = {
      element,
      projection: projected.projection,
      projectedType: projected.type,
      normalization,
      ...(initializer === undefined ? {} : { initializer }),
    };
    if (input.ast.is.IsIdentifier(nameNode)) {
      const targetName = input.bindingNames.get(element);
      if (targetName === undefined) {
        reject(input, "MOJO_BINDING_TARGET_NAME_MISSING", "A binding element has no allocated Mojo name.", element);
        return undefined;
      }
      selections.push(Object.freeze({
        ...common,
        target: Object.freeze({
          kind: "binding" as const,
          declaration: element,
          name: targetName,
          type: bindingType,
        }),
      }));
      continue;
    }
    if (!input.ast.is.IsArrayBindingPattern(nameNode) && !input.ast.is.IsObjectBindingPattern(nameNode)) {
      reject(input, "MOJO_BINDING_TARGET_UNSUPPORTED", "A binding target is neither an identifier nor a nested pattern.", nameNode);
      return undefined;
    }
    const nested = analyzePatternElements(nameNode, bindingType, projected.sourceType, input);
    if (nested === undefined) return undefined;
    selections.push(Object.freeze({
      ...common,
      target: Object.freeze({
        kind: "pattern" as const,
        pattern: nameNode,
        type: bindingType,
        elements: nested,
      }),
    }));
  }
  return Object.freeze(selections);
}

interface ProjectedBindingValue {
  readonly projection: MojoBindingPatternElementSelection["projection"];
  readonly type: MojoTargetTypeRef;
  readonly bindingType?: MojoTargetTypeRef;
  readonly sourceType?: Type;
}

function projectArrayElement(
  sourceType: MojoTargetTypeRef,
  sourceSemanticType: Type | undefined,
  index: number,
  rest: boolean,
  hasDefault: boolean,
  input: MojoBindingPatternAnalysisInput,
): ProjectedBindingValue | undefined {
  if (rest) {
    if (sourceType.kind === "tuple") {
      const expected: MojoTargetTypeRef = Object.freeze({
        kind: "tuple",
        elements: Object.freeze(sourceType.elements.slice(index)),
      });
      return { projection: { kind: "tuple-rest", start: index }, type: expected, bindingType: expected };
    }
    if (sourceType.kind === "fixed-array") {
      const length = safeArrayLength(sourceType);
      if (length === undefined || index > length) return undefined;
      const list: MojoTargetTypeRef = Object.freeze({ kind: "list", element: sourceType.element });
      return {
        projection: { kind: "fixed-array-rest", start: index },
        type: list,
        bindingType: list,
      };
    }
    return sourceType.kind === "list"
      ? { projection: { kind: "list-rest", start: index }, type: sourceType, bindingType: sourceType }
      : undefined;
  }
  const semanticElement = arrayElementSourceType(sourceSemanticType, index, input.semantics);
  if (sourceType.kind === "tuple") {
    const type = sourceType.elements[index];
    return type === undefined
      ? undefined
      : { projection: { kind: "element", index }, type, sourceType: semanticElement };
  }
  if (sourceType.kind === "fixed-array") {
    const length = safeArrayLength(sourceType);
    return length === undefined || index >= length
      ? undefined
      : { projection: { kind: "element", index }, type: sourceType.element, sourceType: semanticElement };
  }
  if (sourceType.kind !== "list") return undefined;
  const type: MojoTargetTypeRef = hasDefault
    ? Object.freeze({ kind: "optional", value: sourceType.element })
    : sourceType.element;
  return {
    projection: { kind: "list-element", index, checked: hasDefault },
    type,
    sourceType: semanticElement,
  };
}

function projectObjectElement(
  sourceType: MojoTargetTypeRef,
  sourceSemanticType: Type | undefined,
  element: Node,
  binding: Node,
  rest: boolean,
  extractedNames: ReadonlySet<string>,
  input: MojoBindingPatternAnalysisInput,
): ProjectedBindingValue | undefined {
  if (rest) {
    if (!input.ast.is.IsIdentifier(binding) || sourceSemanticType === undefined) return undefined;
    const bindingSourceType = input.semantics.declarations.declaredValueType(element) ??
      input.semantics.types.expressionType(binding);
    if (bindingSourceType === undefined) return undefined;
    const targetProperties = input.semantics.types.propertyInfos(bindingSourceType);
    const sourceFields = objectDataFields(sourceType, input);
    const remaining = sourceFields?.filter((field) => !extractedNames.has(field.sourceName));
    if (remaining === undefined || targetProperties.length !== remaining.length ||
      new Set(targetProperties.map((property) => property.name)).size !== targetProperties.length) return undefined;
    const fields = targetProperties.map((property) => {
      const source = remaining.find((candidate) =>
        candidate.sourceName === property.name && semanticPropertyMatches(candidate, property, input));
      return source === undefined
        ? undefined
        : Object.freeze({
            field: Object.freeze({
              sourceName: property.name,
              sourceSymbol: property.symbol,
              sourceRootSymbols: Object.freeze([...property.rootSymbols]),
              sourceDeclarations: Object.freeze([
                ...input.semantics.declarations.symbolDeclarations(property.symbol),
              ]),
              type: source.type,
              optional: property.optional,
              readonly: property.readonly,
            }),
            source,
          });
    });
    if (fields.some((field) => field === undefined)) return undefined;
    const selectedFields = fields as readonly NonNullable<typeof fields[number]>[];
    const definition = input.structuralObjects.define(binding, selectedFields.map(({ field }) => field));
    if (definition === undefined) return undefined;
    return {
      projection: {
        kind: "object-rest",
        fields: Object.freeze(selectedFields.map(({ source }, targetStorageIndex) => Object.freeze({
          source: source.projection,
          sourceType: source.type,
          targetStorageIndex,
        }))),
      },
      type: definition.type,
      bindingType: definition.type,
      sourceType: bindingSourceType,
    };
  }
  const sourceName = bindingPropertyName(element, input.ast);
  if (sourceName === undefined) return undefined;
  const semanticProperty = sourceSemanticType === undefined
    ? undefined
    : uniqueProperty(input.semantics.types.propertyInfos(sourceSemanticType), sourceName);
  const sourceField = semanticProperty === undefined
    ? undefined
    : objectDataFields(sourceType, input)?.find((field) =>
        field.sourceName === sourceName && semanticPropertyMatches(field, semanticProperty, input));
  if (sourceField !== undefined && semanticProperty !== undefined) {
    return {
      projection: sourceField.projection,
      type: sourceField.type,
      sourceType: semanticProperty.type,
    };
  }
  if (sourceType.kind === "dictionary" && sourceType.key.kind === "native-string") {
    return { projection: { kind: "dictionary-key", key: sourceName }, type: sourceType.value };
  }
  return undefined;
}

interface ObjectDataField {
  readonly sourceName: string;
  readonly projection: MojoBindingValueProjection;
  readonly type: MojoTargetTypeRef;
  readonly sourceSymbols: readonly Symbol[];
  readonly sourceDeclarations: readonly Node[];
}

function objectDataFields(
  sourceType: MojoTargetTypeRef,
  input: MojoBindingPatternAnalysisInput,
): readonly ObjectDataField[] | undefined {
  const structural = input.structuralObjects.definitionForType(sourceType);
  if (structural !== undefined) {
    return Object.freeze(structural.fields.map((field, storageIndex) => Object.freeze({
      sourceName: field.sourceName,
      projection: Object.freeze({ kind: "structural-field" as const, storageIndex }),
      type: field.type,
      sourceSymbols: Object.freeze([field.sourceSymbol, ...field.sourceRootSymbols]),
      sourceDeclarations: field.sourceDeclarations,
    })));
  }
  if (sourceType.kind !== "target-named") return undefined;
  const class_ = input.classByTypeId.get(sourceType.id);
  const interface_ = input.interfaceByTypeId.get(sourceType.id);
  const fields = class_?.fields ?? interface_?.fields;
  if (fields === undefined || (interface_?.indexSignatures.length ?? 0) !== 0) return undefined;
  const selected = fields.map((field) => {
    const type = instantiateProjectFieldType(field, sourceType);
    return type === undefined
      ? undefined
      : Object.freeze({
          sourceName: field.sourceName,
          projection: Object.freeze({ kind: "project-field" as const, name: field.name }),
          type: field.kind === "interface-field" && field.optional
            ? Object.freeze({ kind: "optional" as const, value: type })
            : type,
          sourceSymbols: Object.freeze([]),
          sourceDeclarations: Object.freeze([field.declaration]),
        });
  });
  return selected.some((field) => field === undefined)
    ? undefined
    : Object.freeze(selected as readonly ObjectDataField[]);
}

function resolveSourceType(
  type: Type | undefined,
  input: MojoBindingPatternAnalysisInput,
): MojoTargetTypeRef | undefined {
  return type === undefined ? undefined : input.resolveType(type);
}

function selectNormalization(
  projected: MojoTargetTypeRef,
  binding: MojoTargetTypeRef,
  hasDefault: boolean,
): MojoBindingNormalization | undefined {
  if (mojoTargetTypeEquals(projected, binding)) return "identity";
  return hasDefault && projected.kind === "optional" && mojoTargetTypeEquals(projected.value, binding)
    ? "default-on-none"
    : undefined;
}

function safeArrayLength(type: Extract<MojoTargetTypeRef, { readonly kind: "fixed-array" }>): number | undefined {
  if (type.length.kind !== "integer") return undefined;
  const length = Number(type.length.value);
  return Number.isSafeInteger(length) && length >= 0 ? length : undefined;
}

function arrayElementSourceType(
  type: Type | undefined,
  index: number,
  semantics: SourceSemantics,
): Type | undefined {
  if (type === undefined) return undefined;
  if (semantics.types.isTuple(type)) return semantics.types.tupleElementInfos(type)[index]?.type;
  const arguments_ = semantics.types.effectiveTypeArguments(type) ?? semantics.types.typeArguments(type);
  return arguments_[0];
}

function uniqueProperty(
  properties: readonly TypePropertyInfo[],
  name: string,
): TypePropertyInfo | undefined {
  const matches = properties.filter((property) => property.name === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function semanticPropertyMatches(
  field: ObjectDataField,
  property: TypePropertyInfo,
  input: MojoBindingPatternAnalysisInput,
): boolean {
  const symbols = [property.symbol, ...property.rootSymbols];
  if (symbols.some((symbol) => field.sourceSymbols.includes(symbol))) return true;
  const declarations = symbols.flatMap((symbol) =>
    [...input.semantics.declarations.symbolDeclarations(symbol)]);
  return declarations.some((declaration) => field.sourceDeclarations.includes(declaration));
}

function collectObjectExtractedNames(
  pattern: Node,
  ast: AstReader,
): ReadonlySet<string> | undefined {
  const names = new Set<string>();
  for (const element of ast.elements(pattern)) {
    if (element === undefined || ast.is.IsOmittedExpression(element) || !ast.is.IsBindingElement(element)) {
      return undefined;
    }
    if (BindingElement_IsRest(ast, element)) continue;
    const name = bindingPropertyName(element, ast);
    if (name === undefined || names.has(name)) return undefined;
    names.add(name);
  }
  return names;
}

function bindingPropertyName(element: Node, ast: AstReader): string | undefined {
  const name = BindingElement_PropertyName(ast, element) ?? ast.name(element);
  if (name === undefined) return undefined;
  if (ast.is.IsIdentifier(name) || ast.is.IsStringLiteral(name)) return ast.text(name);
  if (!ast.is.IsNumericLiteral(name)) return undefined;
  const value = Number(ast.text(name).replace(/_/gu, ""));
  return Number.isFinite(value) ? String(value) : undefined;
}

function reject(
  input: MojoBindingPatternAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
