import type { Node, SourceFile } from "@tsonic/tsts";
import {
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
} from "@tsonic/target-api/source";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import { mojoAnalysisDiagnostic } from "../diagnostics.js";
import type {
  MojoAnalyzedInterface,
  MojoAnalyzedInterfaceField,
  MojoAnalyzedProjectProperty,
  MojoObjectLiteralContribution,
  MojoObjectLiteralSelection,
} from "../program/model.js";

export interface MojoObjectLiteralAnalysisInput {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
  readonly expression: Node;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly expectedType?: MojoTargetTypeRef;
  readonly interfaceByTypeId: ReadonlyMap<string, MojoAnalyzedInterface>;
  readonly fieldByDeclaration: WeakMap<Node, MojoAnalyzedProjectProperty>;
  readonly resolveType: (type: import("@tsonic/tsts").Type | undefined) => MojoTargetTypeRef | undefined;
  readonly diagnostics: TargetDiagnostic[];
}

export function analyzeMojoObjectLiteral(
  input: MojoObjectLiteralAnalysisInput,
): MojoObjectLiteralSelection | undefined {
  const { source, expression } = input;
  const { ast } = source;
  if (!ast.is.IsObjectLiteralExpression(expression)) return undefined;
  const semantics = source.semantics.forFile(input.sourceFile);
  const contextualSelection = semantics.types.contextualValueSelection(expression);
  const contextualType = contextualSelection.kind === "selected"
    ? input.resolveType(contextualSelection.type)
    : undefined;
  const inferredType = input.expressionTypes.get(expression);
  const targetType = input.expectedType?.kind === "target-named" &&
      input.interfaceByTypeId.has(input.expectedType.id)
    ? input.expectedType
    : contextualType?.kind === "target-named" &&
      input.interfaceByTypeId.has(contextualType.id)
    ? contextualType
    : inferredType;
  const interface_ = targetType?.kind === "target-named"
    ? input.interfaceByTypeId.get(targetType.id)
    : undefined;
  if (targetType === undefined || interface_ === undefined) return undefined;
  const instantiatedFields = instantiateFields(interface_, targetType);
  if (instantiatedFields === undefined) {
    reject(input, "MOJO_OBJECT_INTERFACE_INSTANTIATION_UNRESOLVED", "Object literal interface arguments do not exactly instantiate its declared fields.", expression);
    return undefined;
  }
  const fieldTypes = new Map(instantiatedFields.map((field) => [field.field.declaration, field] as const));
  const contributions: MojoObjectLiteralContribution[] = [];
  const assigned = new Set<Node>();
  for (const element of ast.properties(expression)) {
    if (element === undefined) {
      reject(input, "MOJO_OBJECT_ELEMENT_EVIDENCE_INCOMPLETE", "Object literal contains an undefined source element.", expression);
      return undefined;
    }
    if (ast.is.IsSpreadAssignment(element)) {
      const value = SpreadAssignment_Expression(ast, element);
      const sourceType = value === undefined ? undefined : input.expressionTypes.get(value);
      if (value === undefined || sourceType === undefined || !mojoTargetTypeEquals(sourceType, targetType)) {
        reject(input, "MOJO_OBJECT_SPREAD_CARRIER_UNPROVEN", "Object spread requires one exact value of the same sealed project-interface carrier.", element);
        return undefined;
      }
      contributions.push(Object.freeze({
        kind: "spread",
        element,
        value,
        sourceType,
        fields: Object.freeze(instantiatedFields),
      }));
      for (const field of instantiatedFields) assigned.add(field.field.declaration);
      continue;
    }
    if (!ast.is.IsPropertyAssignment(element) && !ast.is.IsShorthandPropertyAssignment(element)) {
      return undefined;
    }
    const selected = semantics.operations.objectLiteralElement(element);
    const value = ObjectLiteralProperty_Value(ast, element);
    const selectedField = selected?.sourceSelectedDeclaration === undefined
      ? undefined
      : input.fieldByDeclaration.get(selected.sourceSelectedDeclaration);
    const instantiated = selectedField?.kind === "interface-field"
      ? fieldTypes.get(selectedField.declaration)
      : undefined;
    const expectedKind = ast.is.IsPropertyAssignment(element) ? "property" : "shorthand";
    if (selected === undefined || selected.objectLiteral !== expression || selected.element !== element ||
      selected.elementKind !== expectedKind || value === undefined || instantiated === undefined) {
      reject(input, "MOJO_OBJECT_FIELD_SELECTION_UNRESOLVED", "Object property requires one exact checker-selected project-interface field.", element);
      return undefined;
    }
    contributions.push(Object.freeze({
      kind: "field",
      element,
      value,
      field: instantiated.field,
      fieldType: instantiated.fieldType,
    }));
    assigned.add(instantiated.field.declaration);
  }
  const missing = instantiatedFields.find(({ field }) => !field.optional && !assigned.has(field.declaration));
  if (missing !== undefined) {
    reject(input, "MOJO_OBJECT_REQUIRED_FIELD_MISSING", "Object literal omits a required checker-selected project-interface field.", expression);
    return undefined;
  }
  input.expressionTypes.set(expression, targetType);
  return Object.freeze({
    kind: "interface",
    interface: interface_,
    targetType,
    fields: instantiatedFields,
    contributions: Object.freeze(contributions),
  });
}

function instantiateFields(
  interface_: MojoAnalyzedInterface,
  targetType: MojoTargetTypeRef,
): readonly { readonly field: MojoAnalyzedInterfaceField; readonly fieldType: MojoTargetTypeRef }[] | undefined {
  if (targetType.kind !== "target-named" || interface_.targetType.kind !== "target-named" ||
    targetType.id !== interface_.targetType.id) return undefined;
  const arguments_ = targetType.genericArguments ?? [];
  if (arguments_.length !== interface_.typeParameters.length || arguments_.some((argument) => argument.kind !== "type")) {
    return undefined;
  }
  const types = new Map<string, MojoTargetTypeRef>();
  for (const [index, parameter] of interface_.typeParameters.entries()) {
    const argument = arguments_[index];
    if (argument?.kind !== "type") return undefined;
    types.set(parameter.name, argument.type);
  }
  return Object.freeze(interface_.fields.map((field) => Object.freeze({
    field,
    fieldType: substituteMojoTargetType(field.type, { types, constants: new Map() }),
  })));
}

function reject(
  input: MojoObjectLiteralAnalysisInput,
  code: string,
  message: string,
  node: Node,
): void {
  input.diagnostics.push(mojoAnalysisDiagnostic(code, message, node));
}
