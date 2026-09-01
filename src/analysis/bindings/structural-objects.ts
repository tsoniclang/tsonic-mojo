import type { AstReader, Node, Symbol } from "@tsonic/tsts";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export interface MojoStructuralObjectField {
  readonly sourceName: string;
  readonly sourceSymbol: Symbol;
  readonly sourceRootSymbols: readonly Symbol[];
  readonly sourceDeclarations: readonly Node[];
  readonly type: MojoTargetTypeRef;
  readonly optional: boolean;
  readonly readonly: boolean;
}

export interface MojoStructuralObjectDefinition {
  readonly id: string;
  readonly type: Extract<MojoTargetTypeRef, { readonly kind: "target-named" }>;
  readonly fields: readonly MojoStructuralObjectField[];
}

export interface MojoStructuralObjectCatalog {
  define(
    occurrence: Node,
    fields: readonly MojoStructuralObjectField[],
  ): MojoStructuralObjectDefinition | undefined;
  definitionForType(type: MojoTargetTypeRef | undefined): MojoStructuralObjectDefinition | undefined;
}

export function createMojoStructuralObjectCatalog(ast: AstReader): MojoStructuralObjectCatalog {
  const definitions = new Map<string, MojoStructuralObjectDefinition>();
  return Object.freeze({
    define(
      occurrence: Node,
      fields: readonly MojoStructuralObjectField[],
    ): MojoStructuralObjectDefinition | undefined {
      const occurrenceIdentity = sourceNodeIdentity(ast, occurrence);
      if (occurrenceIdentity === undefined ||
        new Set(fields.map((field) => field.sourceName)).size !== fields.length) return undefined;
      const id = `tsonic.mojo.structural-object:${occurrenceIdentity}`;
      const storageType: MojoTargetTypeRef = Object.freeze({
        kind: "tuple",
        elements: Object.freeze(fields.map((field) => field.type)),
      });
      const type = Object.freeze({
        kind: "target-named" as const,
        id,
        modulePath: Object.freeze(["tsonic_runtime"]),
        name: "StructuralObject",
        genericArguments: Object.freeze([Object.freeze({ kind: "type" as const, type: storageType })]),
      });
      const definition = Object.freeze({
        id,
        type,
        fields: Object.freeze(fields.map((field) => Object.freeze({ ...field }))),
      });
      const existing = definitions.get(id);
      if (existing !== undefined) {
        return sameDefinition(existing, definition) ? existing : undefined;
      }
      definitions.set(id, definition);
      return definition;
    },
    definitionForType(type: MojoTargetTypeRef | undefined): MojoStructuralObjectDefinition | undefined {
      return type?.kind === "target-named" ? definitions.get(type.id) : undefined;
    },
  });
}

function sameDefinition(
  left: MojoStructuralObjectDefinition,
  right: MojoStructuralObjectDefinition,
): boolean {
  return mojoTargetTypeEquals(left.type, right.type) && left.fields.length === right.fields.length &&
    left.fields.every((field, index) => {
      const selected = right.fields[index];
      return selected !== undefined && field.sourceName === selected.sourceName &&
        field.sourceSymbol === selected.sourceSymbol &&
        sameIdentitySet(field.sourceRootSymbols, selected.sourceRootSymbols) &&
        sameIdentitySet(field.sourceDeclarations, selected.sourceDeclarations) &&
        field.optional === selected.optional && field.readonly === selected.readonly &&
        mojoTargetTypeEquals(field.type, selected.type);
    });
}

function sameIdentitySet(left: readonly object[], right: readonly object[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}
