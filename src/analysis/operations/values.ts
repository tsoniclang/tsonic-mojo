import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoConversionIndex } from "../../policy/conversions/selection.js";
import type { MojoValueSelection } from "../program/model.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import { instantiateMojoProviderConstantOperation } from "../../policy/operations/provider-instantiation.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";

export type MojoValueAnalysis =
  | { readonly kind: "not-provider" }
  | { readonly kind: "resolved"; readonly selection: MojoValueSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoProviderValue(
  expression: Node,
  selectedType: MojoTargetTypeRef,
  source: TargetSourceProgram,
  providerSemantics: MojoProviderSemantics,
  conversions: MojoConversionIndex,
): MojoValueAnalysis {
  const reference = source.navigation.sourceReferenceFor(expression);
  const identity = selectedProviderDeclarationIdentity(source, [
    reference?.declaration,
    reference?.symbol,
  ]);
  if (identity === undefined) return { kind: "not-provider" };
  if (identity.exportId === undefined || identity.memberId !== undefined || identity.signatureId !== undefined) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_VALUE_IDENTITY_INCOMPLETE",
      reason: "Selected provider value has no exact module-export identity.",
    };
  }
  const rows = providerSemantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.memberId === undefined && row.signatureId === undefined && row.operationKind === "property" &&
    row.target.kind === "constant");
  if (rows.length !== 1) {
    return {
      kind: "unsupported",
      code: rows.length === 0 ? "MOJO_PROVIDER_VALUE_OPERATION_MISSING" : "MOJO_PROVIDER_VALUE_OPERATION_AMBIGUOUS",
      reason: `Selected provider value has ${rows.length} exact Mojo constant operations.`,
    };
  }
  const instantiated = instantiateMojoProviderConstantOperation(rows[0]!);
  if (instantiated.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_PROVIDER_VALUE_NOT_CLOSED", reason: instantiated.reason };
  }
  const conversion = conversions.record(expression, instantiated.operation.resultType, selectedType);
  return conversion.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_PROVIDER_VALUE_CONVERSION_UNPROVEN", reason: conversion.reason }
    : {
        kind: "resolved",
        selection: Object.freeze({
          kind: "provider-constant",
          operation: instantiated.operation,
          resultConversion: conversion.conversion,
        }),
      };
}
