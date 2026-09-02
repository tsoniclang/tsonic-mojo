import type {
  Node,
  ResolvedSourcePropertyAccessInfo,
  Symbol,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoStructuralObjectCatalog } from "../bindings/structural-objects.js";
import type { MojoPropertySelection } from "../program/model.js";

export type MojoStructuralFieldAnalysis =
  | {
      readonly kind: "resolved";
      readonly selection: MojoPropertySelection;
      readonly expressionType: MojoTargetTypeRef;
    }
  | { readonly kind: "not-structural-field" }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoStructuralProperty(input: {
  readonly source: ResolvedSourcePropertyAccessInfo;
  readonly receiverType: MojoTargetTypeRef | undefined;
  readonly structuralObjects: MojoStructuralObjectCatalog;
  readonly semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>;
}): MojoStructuralFieldAnalysis {
  const { source, receiverType } = input;
  const definition = input.structuralObjects.definitionForType(receiverType);
  if (definition === undefined) return { kind: "not-structural-field" };
  if (source.accessMode === "delete") {
    return unsupported(
      "MOJO_STRUCTURAL_PROPERTY_DELETE_UNSUPPORTED",
      "Deleting a closed structural-object field has no Mojo storage operation.",
    );
  }
  const selectedSymbols = exactSelectedSymbols(source, input.semantics);
  const selectedDeclarations = exactSelectedDeclarations(source);
  const matching = definition.fields
    .map((field, storageIndex) => ({ field, storageIndex }))
    .filter(({ field }) =>
      selectedSymbols.some((symbol) =>
        field.sourceSymbol === symbol || field.sourceRootSymbols.includes(symbol)) ||
      selectedDeclarations.some((declaration) => field.sourceDeclarations.includes(declaration)));
  if (selectedSymbols.length === 0 && selectedDeclarations.length === 0) {
    return unsupported(
      "MOJO_STRUCTURAL_PROPERTY_IDENTITY_MISSING",
      "A structural-object property requires one exact checker-selected symbol or declaration identity.",
    );
  }
  if (matching.length !== 1) {
    return unsupported(
      matching.length === 0
        ? "MOJO_STRUCTURAL_PROPERTY_IDENTITY_UNRESOLVED"
        : "MOJO_STRUCTURAL_PROPERTY_IDENTITY_AMBIGUOUS",
      `The checker-selected structural property matches ${matching.length} exact storage fields.`,
    );
  }
  const selected = matching[0]!;
  if ((source.accessMode === "read" || source.accessMode === "read-write") &&
      source.sourceReadType === undefined ||
    (source.accessMode === "write" || source.accessMode === "read-write") &&
      source.sourceWriteType === undefined) {
    return unsupported(
      "MOJO_STRUCTURAL_PROPERTY_ACCESS_EVIDENCE_MISSING",
      "A structural-object field access has no exact checker-selected read or write evidence.",
    );
  }
  const fieldType = selected.field.type;
  if (receiverType === undefined) {
    return unsupported(
      "MOJO_STRUCTURAL_PROPERTY_CARRIER_MISSING",
      "A structural-object property has no exact receiver and field carrier.",
    );
  }
  return {
    kind: "resolved",
    expressionType: optionalAccessResult(fieldType, source.optionalChain),
    selection: Object.freeze({
      kind: "structural-field",
      receiver: source.receiver.expression,
      receiverType,
      storageIndex: selected.storageIndex,
      fieldType,
      accessMode: source.accessMode,
      optionalChain: source.optionalChain,
    }),
  };
}

function exactSelectedSymbols(
  source: ResolvedSourcePropertyAccessInfo,
  semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>,
): readonly Symbol[] {
  const symbols = [source.selectedSymbol, source.sourceSymbol]
    .filter((symbol): symbol is Symbol => symbol !== undefined);
  const selected = new Set<Symbol>();
  for (const symbol of symbols) {
    selected.add(symbol);
    for (const root of semantics.declarations.rootSymbols(symbol)) selected.add(root);
  }
  return Object.freeze([...selected]);
}

function exactSelectedDeclarations(
  source: ResolvedSourcePropertyAccessInfo,
): readonly Node[] {
  return Object.freeze([...new Set([
    source.selectedDeclaration,
    source.selectedReadDeclaration,
    source.selectedWriteDeclaration,
    source.sourceDeclaration,
  ].filter((declaration): declaration is Node => declaration !== undefined))]);
}

function optionalAccessResult(
  type: MojoTargetTypeRef,
  optionalChain: boolean,
): MojoTargetTypeRef {
  return !optionalChain || type.kind === "optional"
    ? type
    : Object.freeze({ kind: "optional", value: type });
}

function unsupported(
  code: string,
  reason: string,
): Extract<MojoStructuralFieldAnalysis, { readonly kind: "unsupported" }> {
  return { kind: "unsupported", code, reason };
}
