import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type {
  MojoProviderSemantics,
  MojoProviderTypeRow,
} from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { selectedProviderDeclarationIdentity } from "../operations/provider-selection.js";
import { providerOwnerMatches } from "./resolution.js";

export type MojoProviderObjectLiteralConstructionSelection =
  | { readonly kind: "not-applicable" }
  | {
      readonly kind: "selected";
      readonly targetType: MojoTargetTypeRef;
      readonly typeRow: MojoProviderTypeRow;
    }
  | { readonly kind: "conflict"; readonly reason: string };

export function selectMojoProviderObjectLiteralConstruction(
  source: TargetSourceProgram,
  expression: Node,
  expectedType: MojoTargetTypeRef | undefined,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  providerSemantics: MojoProviderSemantics,
  resolveType: (type: Type) => MojoTargetTypeRef | undefined,
): MojoProviderObjectLiteralConstructionSelection {
  if (!source.ast.is.IsObjectLiteralExpression(expression)) {
    return { kind: "not-applicable" };
  }
  const contextual = semantics.types.contextualValueSelection(expression);
  if (contextual.kind !== "selected") return { kind: "not-applicable" };
  const identity = selectedProviderDeclarationIdentity(
    source,
    semantics.facts.typeSubjects(contextual.type),
  );
  if (identity?.exportId === undefined) return { kind: "not-applicable" };
  const rows = providerSemantics.types.filter((row) =>
    providerOwnerMatches(row, identity) && row.exportId === identity.exportId &&
    row.objectLiteralConstruction?.kind === "struct-default");
  if (rows.length === 0) return { kind: "not-applicable" };
  if (rows.length !== 1) {
    return { kind: "conflict", reason: `selected provider type has ${rows.length} object-literal construction relations` };
  }
  const targetType = resolveType(contextual.type);
  if (targetType === undefined ||
    (expectedType !== undefined && !mojoTargetTypeEquals(targetType, expectedType))) {
    return { kind: "conflict", reason: "provider object-literal construction conflicts with its exact contextual target carrier" };
  }
  return Object.freeze({ kind: "selected", targetType, typeRow: rows[0]! });
}
