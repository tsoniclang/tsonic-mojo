import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoValueSelection } from "../program/model.js";
import { providerOwnerMatches } from "../../policy/types/resolution.js";
import { instantiateMojoProviderConstantOperation } from "../../policy/operations/provider-instantiation.js";
import { selectedProviderDeclarationIdentity } from "../../policy/operations/provider-selection.js";
import {
  classifyMojoSourceResultConversion,
  mojoConvertedValueType,
} from "./call-results.js";

export type MojoValueAnalysis =
  | { readonly kind: "not-provider" }
  | {
      readonly kind: "resolved";
      readonly selection: MojoValueSelection;
      readonly expressionType: MojoTargetTypeRef;
    }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoProviderValue(
  expression: Node,
  selectedType: MojoTargetTypeRef,
  source: TargetSourceProgram,
  providerSemantics: MojoProviderSemantics,
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
  const exportedValues = providerSemantics.exports.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.declarationKind === "value");
  if (exportedValues.length === 0) return { kind: "not-provider" };
  if (exportedValues.length !== 1) {
    return {
      kind: "unsupported",
      code: "MOJO_PROVIDER_VALUE_IDENTITY_AMBIGUOUS",
      reason: `Selected provider value has ${exportedValues.length} exact module-export identities.`,
    };
  }
  const rows = providerSemantics.operations.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.memberId === undefined && row.signatureId === undefined && row.operationKind === "property" &&
    (row.target.kind === "constant" || row.target.kind === "function-read"));
  if (rows.length !== 1) {
    return {
      kind: "unsupported",
      code: rows.length === 0 ? "MOJO_PROVIDER_VALUE_OPERATION_MISSING" : "MOJO_PROVIDER_VALUE_OPERATION_AMBIGUOUS",
      reason: `Selected provider value has ${rows.length} exact Mojo value operations.`,
    };
  }
  const instantiated = instantiateMojoProviderConstantOperation(rows[0]!);
  if (instantiated.kind === "unsupported") {
    return { kind: "unsupported", code: "MOJO_PROVIDER_VALUE_NOT_CLOSED", reason: instantiated.reason };
  }
  const conversion = classifyMojoSourceResultConversion(
    instantiated.operation.resultType,
    selectedType,
  );
  return conversion.kind === "unsupported"
    ? { kind: "unsupported", code: "MOJO_PROVIDER_VALUE_CONVERSION_UNPROVEN", reason: conversion.reason }
    : {
        kind: "resolved",
        expressionType: mojoConvertedValueType(
          instantiated.operation.resultType,
          conversion.conversion,
        ),
        selection: Object.freeze({
          kind: "provider-constant",
          operation: instantiated.operation,
          resultConversion: conversion.conversion,
        }),
      };
}
