import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { SourceStructuralMember } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoRecordMemberRead, MojoValueConversion } from "../../target-model/conversions/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import type { MojoCallAnalysisContext } from "../operations/calls.js";
import type { MojoCallArgumentTarget } from "../operations/call-arguments.js";
import type { MojoArgumentConversionMap, MojoSelectedArgumentBinding } from "../operations/call-argument-conversions.js";
import { selectedMojoArgumentCarrier } from "../operations/call-argument-carriers.js";
import { targetFieldInventory } from "./provider-records.js";

type Selection =
  | { readonly kind: "resolved"; readonly conversion: MojoValueConversion }
  | { readonly kind: "not-applicable" }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function providerRecordArgumentConversions(
  call: ResolvedSourceCallInfo,
  parameterTypes: readonly MojoTargetTypeRef[],
  targets: readonly MojoCallArgumentTarget[],
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): { readonly kind: "resolved"; readonly conversions: MojoArgumentConversionMap } |
  Extract<Selection, { readonly kind: "unsupported" }> {
  const conversions = new Map<MojoSelectedArgumentBinding, MojoValueConversion>();
  for (const binding of call.sourceArgumentBindings) {
    const target = parameterTypes[binding.sourceParameterIndex];
    const selected = call.sourceSelectedSignatureParameters[binding.sourceParameterIndex];
    const actual = selectedMojoArgumentCarrier(context.source.ast, call, binding, context.expressionTypes, resolve);
    if (target === undefined || selected === undefined || actual === undefined ||
      mojoTargetTypeEquals(actual.type, target) || binding.sourceForm === "spread-sequence") continue;
    const projection = selectRecordConversion(
      binding.selectedArgumentType, selected.selectedType, actual.type, target,
      actual.expression, resolve, context, new Set(),
    );
    if (projection.kind === "unsupported") return projection;
    if (projection.kind === "not-applicable") continue;
    const convention = targets[binding.sourceParameterIndex]?.convention;
    if (convention === "mut" || convention === "ref" || convention === "out") {
      return unsupported("A provider record snapshot cannot replace mutable source storage.");
    }
    conversions.set(binding, projection.conversion);
  }
  return Object.freeze({ kind: "resolved", conversions });
}

function selectRecordConversion(
  source: Type, destination: Type,
  actual: MojoTargetTypeRef, expected: MojoTargetTypeRef,
  expression: Node, resolve: (type: Type) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext, active: Set<Type>,
): Selection {
  const semantics = context.source.semantics.forNode(expression);
  const targetType = expected.kind === "optional" ? expected.value : expected;
  const sourceType = actual.kind === "optional" ? actual.value : actual;
  const destinationType = expected.kind === "optional"
    ? semantics.types.withoutMissingOrUndefined(destination) : destination;
  const selectedSource = actual.kind === "optional"
    ? semantics.types.withoutMissingOrUndefined(source) : source;
  if (destinationType === undefined || selectedSource === undefined) return { kind: "not-applicable" };
  const identity = selectedProviderDeclarationIdentity(context.source, semantics.facts.typeSubjects(destinationType));
  if (identity?.exportId === undefined) return { kind: "not-applicable" };
  const rows = context.providerSemantics.types.filter((row) =>
    row.objectLiteralConstruction?.kind === "struct-default" &&
    row.exportId === identity.exportId && providerOwnerMatches(row, identity));
  if (rows.length === 0) return { kind: "not-applicable" };
  const destinationCarrier = resolve(destinationType);
  if (rows.length !== 1 || destinationCarrier === undefined || !mojoTargetTypeEquals(destinationCarrier, targetType)) {
    return unsupported("Provider record conversion has no unique exact destination carrier.");
  }
  if (actual.kind === "optional" && expected.kind !== "optional") return unsupported("An optional record requires an exact source narrowing before projection.");
  if (active.has(destinationType)) return unsupported("Recursive provider record snapshots require a closed finite field conversion.");
  active.add(destinationType);
  const correspondence = semantics.types.structuralMembers(selectedSource, destinationType);
  if (correspondence.kind !== "available") return unsupported(`Provider record correspondence is unavailable: ${correspondence.reason}.`);
  if (correspondence.destination.calls.length !== 0 || correspondence.destination.constructs.length !== 0 ||
    correspondence.destination.indexes.length !== 0) return unsupported("A field snapshot does not discharge callable, construct or index obligations.");
  const inventory = targetFieldInventory(rows[0]!, targetType, context.providerSemantics);
  if (inventory === undefined) return unsupported("Provider record fields have no complete exact native inventory.");
  const fields: Extract<MojoValueConversion, { kind: "provider-record" }>["fields"][number][] = [];
  const seen = new Set<string>();
  for (const pair of correspondence.members) {
    const member = selectedProviderDeclarationIdentity(context.source, [
      pair.destination.property.symbol, ...pair.destination.property.rootSymbols, ...pair.destination.declarations,
    ]);
    if (member?.memberId === undefined || member.exportId !== rows[0]!.exportId ||
      !providerOwnerMatches(rows[0]!, member) || seen.has(member.memberId)) return unsupported("Provider record member identity is missing, contradictory or duplicated.");
    seen.add(member.memberId);
    const field = inventory.get(member.memberId);
    if (field === undefined) return unsupported("A selected provider record member has no native storage field.");
    if (pair.kind === "absent") continue;
    const read = selectRead(pair.source, sourceType, context);
    if (read === undefined) return unsupported("A selected source record member has no exact readable storage or accessor implementation.");
    const valueType = read.type;
    const nested = selectRecordConversion(pair.source.property.type, pair.destination.property.type,
      valueType, field.storageType, expression, resolve, context, active);
    if (nested.kind === "unsupported") return nested;
    const conversion = nested.kind === "resolved" ? nested : context.conversions.classify(valueType, field.storageType);
    if (conversion.kind === "unsupported") return unsupported(`A selected record field cannot convert: ${conversion.reason}.`);
    fields.push(Object.freeze({ memberId: member.memberId, targetName: field.targetName,
      read: read.read, sourceType: valueType, targetType: field.storageType, conversion: conversion.conversion }));
  }
  active.delete(destinationType);
  if (seen.size !== inventory.size) return unsupported("Provider source and native field inventories differ.");
  const conversion = Object.freeze<MojoValueConversion>({ kind: "provider-record", sourceType, targetType, fields: Object.freeze(fields) });
  return { kind: "resolved", conversion: expected.kind !== "optional" ? conversion : actual.kind === "optional"
    ? Object.freeze({ kind: "optional-map", sourceType: actual, targetType: expected, valueConversion: conversion })
    : Object.freeze({ kind: "optional-some", targetType: expected, valueConversion: conversion }) };
}

function selectRead(
  member: SourceStructuralMember, receiver: MojoTargetTypeRef, context: MojoCallAnalysisContext,
): { readonly read: MojoRecordMemberRead; readonly type: MojoTargetTypeRef } | undefined {
  const definition = context.structuralObjects.definitionForType(receiver);
  if (definition !== undefined) {
    const symbols = [member.property.symbol, ...member.property.rootSymbols];
    const candidates = definition.fields.flatMap((field, index) =>
      symbols.some((symbol) => field.sourceSymbol === symbol || field.sourceRootSymbols.includes(symbol)) ||
      member.declarations.some((declaration) => field.sourceDeclarations.includes(declaration)) ? [{ field, index }] : []);
    if (candidates.length !== 1 || member.read !== "property") return undefined;
    return { read: Object.freeze({ kind: "structural", index: candidates[0]!.index }), type: candidates[0]!.field.type };
  }
  const properties = [...new Set(member.declarations.flatMap((declaration) => {
    const property = context.fieldByDeclaration.get(declaration);
    return property === undefined ? [] : [property];
  }))];
  if (properties.length !== 1) return undefined;
  const property = properties[0]!;
  if (property.kind === "accessor-property") {
    const owner = context.projectRelationships.definitionForType(receiver);
    if (owner === undefined || owner.kind !== "class" || context.projectRelationships.isPolymorphic(owner)) return undefined;
    const getter = property.read;
    if (member.read !== "accessor" || getter === undefined || getter.static || getter.asynchronous ||
      getter.typeParameters.length !== 0 || getter.parameters.length !== 0 || !member.getters.includes(getter.declaration)) return undefined;
    const type = context.projectRelationships.instantiateMemberType(getter.declaration, receiver, getter.resultType);
    return type === undefined ? undefined : { read: Object.freeze({ kind: "accessor", declaration: getter.declaration, name: getter.name }), type };
  }
  if (member.read !== "property" || property.kind !== "instance-field" && property.kind !== "interface-field") return undefined;
  const type = context.projectRelationships.instantiateMemberType(property.declaration, receiver, property.type);
  return type === undefined ? undefined : { read: Object.freeze({ kind: "field", declaration: property.declaration, name: property.name }), type };
}

function unsupported(reason: string): Extract<Selection, { readonly kind: "unsupported" }> {
  return { kind: "unsupported", code: "MOJO_PROVIDER_RECORD_CONVERSION_UNPROVEN", reason };
}
