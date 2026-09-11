import type { Node, PointerOperationFact } from "@tsonic/tsts";
import { sourceNodeIdentity, Node_Expression } from "@tsonic/target-api/source";
import type { MojoTypedLocationAnalysisInput } from "../operations/typed-locations.js";
import type { MojoAddressedStorage, MojoLocationOwnerIdentity } from "../../target-model/operations/typed-locations.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";

export function mojoLocationOwnerIdentity(type: MojoTargetTypeRef, input: MojoTypedLocationAnalysisInput): MojoLocationOwnerIdentity | undefined {
  if (type.kind === "callable") return "callable";
  if (type.kind !== "target-named") return undefined;
  const definition = input.projectRelationships.definitionForType(type);
  if (definition !== undefined && definition.kind !== "enum") {
    return input.projectRelationships.isPolymorphic(definition) ? "project-polymorphic" : "project";
  }
  if (input.structuralObjects.definitionForType(type) !== undefined) return "structural";
  if (type.id === "tsonic.mojo.js.JsArray") return "array";
  return undefined;
}

export function analyzeMojoAddressedStorage(
  fact: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  pointee: MojoTargetTypeRef,
  input: MojoTypedLocationAnalysisInput,
): MojoAddressedStorage | undefined {
  const expression = unwrapMojoStorageExpression(fact.storageExpression, input);
  const source = input.source;
  if (source.ast.is.IsIdentifier(expression)) {
    const reference = source.navigation.sourceReferenceFor(expression);
    if (reference?.project === true && reference.declaration === fact.storageDeclaration &&
      reference.declaration !== undefined && input.locationStorageNames.has(reference.declaration)) {
      return Object.freeze({ kind: "local", declaration: reference.declaration });
    }
    return undefined;
  }
  const property = input.propertySelections.get(expression);
  if (property?.kind === "project-field" || property?.kind === "structural-field") {
    if (mojoLocationOwnerIsInitializing(property.receiver, input)) return undefined;
    if (property.optionalChain || !mojoTargetTypeEquals(property.fieldType, pointee)) return undefined;
    const identity = mojoLocationOwnerIdentity(property.receiverType, input);
    if (identity === undefined) return undefined;
    let key: string | undefined;
    if (property.kind === "project-field") {
      const field = input.fieldByDeclaration.get(property.declaration);
      if (field?.kind !== "instance-field" && field?.kind !== "interface-field") return undefined;
      if (field.kind === "interface-field" && field.readonly) return undefined;
      if (fact.storageDeclaration !== property.declaration) return undefined;
      key = sourceNodeIdentity(source.ast, property.declaration);
    } else {
      const definition = input.structuralObjects.definitionForType(property.receiverType);
      const field = definition?.fields[property.storageIndex];
      if (field === undefined || field.readonly || fact.storageDeclaration === undefined ||
        !field.sourceDeclarations.includes(fact.storageDeclaration)) return undefined;
      key = `${definition!.id}:${property.storageIndex}`;
    }
    return key === undefined ? undefined : Object.freeze({
      kind: "field", expression, receiver: property.receiver, receiverType: property.receiverType, identity, key,
    });
  }
  const element = input.elementSelections.get(expression);
  if (element?.kind !== "provider" || element.optionalChain ||
    element.sourceReceiverType.kind !== "target-named" || element.sourceReceiverType.id !== "tsonic.mojo.js.JsArray" ||
    element.readType === undefined || !mojoTargetTypeEquals(element.readType, pointee) ||
    element.readOperation?.target.kind !== "index-read") return undefined;
  const indexType = element.readOperation.parameterTypes[0];
  if (indexType === undefined) return undefined;
  return Object.freeze({ kind: "element", expression, receiver: element.receiver,
    receiverType: element.sourceReceiverType, identity: "array", index: element.index, indexType });
}

export function unwrapMojoStorageExpression(expression: Node, input: Pick<MojoTypedLocationAnalysisInput, "source">): Node {
  const ast = input.source.ast;
  let current = expression;
  while (ast.is.IsParenthesizedExpression(current) || ast.is.IsNonNullExpression(current)) {
    const inner = Node_Expression(ast, current);
    if (inner === undefined) break;
    current = inner;
  }
  return current;
}

export function mojoLocationOwnerIsInitializing(expression: Node, input: Pick<MojoTypedLocationAnalysisInput, "source">): boolean {
  const ast = input.source.ast;
  if (ast.kindName(unwrapMojoStorageExpression(expression, input)) !== "KindThisKeyword") return false;
  let owner = ast.parent(expression);
  while (owner !== undefined) {
    if (ast.is.IsConstructorDeclaration(owner) || ast.is.IsPropertyDeclaration(owner)) return true;
    if (ast.is.IsMethodDeclaration(owner) || ast.is.IsGetAccessorDeclaration(owner) ||
      ast.is.IsSetAccessorDeclaration(owner) || ast.is.IsFunctionDeclaration(owner) ||
      ast.is.IsFunctionExpression(owner)) return false;
    owner = ast.parent(owner);
  }
  return false;
}
