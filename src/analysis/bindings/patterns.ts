import type { AstReader, Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import {
  BindingElement_IsRest,
  BindingElement_PropertyName,
  Node_Initializer,
} from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import { instantiateProjectFieldType } from "../operations/properties.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
  MojoBindingPatternElementSelection,
  MojoBindingPatternSelection,
} from "../program/model.js";

export interface MojoBindingPatternAnalysisInput {
  readonly ast: AstReader;
  readonly declaration: Node;
  readonly initializer: Node;
  readonly sourceType: MojoTargetTypeRef;
  readonly bindingNames: WeakMap<Node, string>;
  readonly bindingTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly classByTypeId: ReadonlyMap<string, MojoAnalyzedClass>;
  readonly interfaceByTypeId: ReadonlyMap<string, MojoAnalyzedInterface>;
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
  const elements = analyzePatternElements(pattern, input.sourceType, input);
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
  input: MojoBindingPatternAnalysisInput,
): readonly MojoBindingPatternElementSelection[] | undefined {
  const array = input.ast.is.IsArrayBindingPattern(pattern);
  const object = input.ast.is.IsObjectBindingPattern(pattern);
  if (!array && !object) return undefined;
  const selections: MojoBindingPatternElementSelection[] = [];
  for (const [index, element] of input.ast.elements(pattern).entries()) {
    if (element === undefined || input.ast.is.IsOmittedExpression(element)) continue;
    if (!input.ast.is.IsBindingElement(element)) {
      reject(input, "MOJO_BINDING_ELEMENT_UNSUPPORTED", "A binding pattern contains a non-binding element.", element);
      return undefined;
    }
    if (BindingElement_IsRest(input.ast, element)) {
      reject(
        input,
        "MOJO_BINDING_REST_NOT_CLOSED",
        "Rest destructuring requires one sealed aggregate reconstruction contract.",
        element,
      );
      return undefined;
    }
    if (Node_Initializer(input.ast, element) !== undefined) {
      reject(
        input,
        "MOJO_BINDING_DEFAULT_NOT_CLOSED",
        "Defaulted destructuring requires one sealed missing-value normalization contract.",
        element,
      );
      return undefined;
    }
    if (array && input.ast.name(element) === undefined) continue;
    const projected = array
      ? projectArrayElement(sourceType, index)
      : projectObjectElement(sourceType, element, input);
    if (projected === undefined) {
      reject(
        input,
        "MOJO_BINDING_PROJECTION_UNSUPPORTED",
        "The exact source aggregate has no Mojo projection for this binding element.",
        element,
      );
      return undefined;
    }
    const nameNode = input.ast.name(element);
    if (nameNode === undefined) {
      reject(input, "MOJO_BINDING_NAME_MISSING", "A binding element has no exact target name.", element);
      return undefined;
    }
    if (input.ast.is.IsIdentifier(nameNode)) {
      const targetName = input.bindingNames.get(element);
      if (targetName === undefined) {
        reject(input, "MOJO_BINDING_TARGET_NAME_MISSING", "A binding element has no allocated Mojo name.", element);
        return undefined;
      }
      input.bindingTypes.set(element, projected.type);
      input.bindingTypes.set(nameNode, projected.type);
      selections.push(Object.freeze({
        element,
        projection: projected.projection,
        projectedType: projected.type,
        target: Object.freeze({
          kind: "binding",
          declaration: element,
          name: targetName,
          type: projected.type,
        }),
      }));
      continue;
    }
    if (!input.ast.is.IsArrayBindingPattern(nameNode) && !input.ast.is.IsObjectBindingPattern(nameNode)) {
      reject(input, "MOJO_BINDING_TARGET_UNSUPPORTED", "A binding target is neither an identifier nor a nested pattern.", nameNode);
      return undefined;
    }
    const nested = analyzePatternElements(nameNode, projected.type, input);
    if (nested === undefined) return undefined;
    selections.push(Object.freeze({
      element,
      projection: projected.projection,
      projectedType: projected.type,
      target: Object.freeze({ kind: "pattern", pattern: nameNode, elements: nested }),
    }));
  }
  return Object.freeze(selections);
}

interface ProjectedBindingValue {
  readonly projection: MojoBindingPatternElementSelection["projection"];
  readonly type: MojoTargetTypeRef;
}

function projectArrayElement(
  sourceType: MojoTargetTypeRef,
  index: number,
): ProjectedBindingValue | undefined {
  if (sourceType.kind === "tuple") {
    const type = sourceType.elements[index];
    return type === undefined ? undefined : { projection: { kind: "element", index }, type };
  }
  if (sourceType.kind === "fixed-array") {
    const length = sourceType.length.kind === "integer" ? Number(sourceType.length.value) : undefined;
    return length === undefined || !Number.isSafeInteger(length) || index >= length
      ? undefined
      : { projection: { kind: "element", index }, type: sourceType.element };
  }
  return sourceType.kind === "list"
    ? { projection: { kind: "element", index }, type: sourceType.element }
    : undefined;
}

function projectObjectElement(
  sourceType: MojoTargetTypeRef,
  element: Node,
  input: MojoBindingPatternAnalysisInput,
): ProjectedBindingValue | undefined {
  const sourceName = bindingPropertyName(element, input.ast);
  if (sourceName === undefined) return undefined;
  if (sourceType.kind === "dictionary" && sourceType.key.kind === "native-string") {
    return { projection: { kind: "dictionary-key", key: sourceName }, type: sourceType.value };
  }
  if (sourceType.kind !== "target-named") return undefined;
  const class_ = input.classByTypeId.get(sourceType.id);
  const interface_ = input.interfaceByTypeId.get(sourceType.id);
  const field = class_?.fields.find((candidate) => candidate.sourceName === sourceName) ??
    interface_?.fields.find((candidate) => candidate.sourceName === sourceName);
  if (field === undefined || (field.kind === "interface-field" && field.optional)) return undefined;
  const type = instantiateProjectFieldType(field, sourceType);
  return type === undefined
    ? undefined
    : { projection: { kind: "project-field", name: field.name }, type };
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
