import type { Node } from "@tsonic/tsts";
import type { MojoProviderTargetGenericParameter, MojoTargetTypeRef } from "../types/model.js";
import type { MojoValueConversion } from "./model.js";
import type { MojoSourceValueFunction } from "./source-value-function.js";

export interface MojoJsValueGraph {
  readonly root: string;
  readonly definitions: readonly MojoJsValueProjection[];
}

export interface MojoJsValueField {
  readonly sourceName: string;
  readonly projection: string;
  readonly access:
    | { readonly kind: "structural"; readonly index: number }
    | { readonly kind: "project"; readonly declaration: Node; readonly path: readonly string[] };
}

export interface MojoJsValueJsonMethod {
  readonly declaration: Node;
  readonly name: string;
  readonly passesPropertyKey: boolean;
  readonly resultType: MojoTargetTypeRef;
  readonly resultProjection: string;
}

export interface MojoJsValueAccessor {
  readonly sourceName: string;
  readonly declaration: Node;
  readonly name: string;
  readonly resultType: MojoTargetTypeRef;
  readonly resultProjection: string;
}

export interface MojoJsValueGenericParameter extends MojoProviderTargetGenericParameter {
  readonly identity: string;
}

interface ProjectionIdentity {
  readonly id: string;
  readonly sourceType: MojoTargetTypeRef;
  readonly genericParameters: readonly MojoJsValueGenericParameter[];
}

export type MojoJsValueProjection = ProjectionIdentity & (
  | {
      readonly kind: "scalar";
      readonly conversion: Extract<MojoValueConversion, { readonly kind: "identity" | "js-box" }>;
    }
  | { readonly kind: "optional"; readonly value: string }
  | { readonly kind: "provider"; readonly factory: MojoSourceValueFunction }
  | { readonly kind: "union"; readonly members: readonly { readonly sourceType: MojoTargetTypeRef; readonly projection: string }[] }
  | {
      readonly kind: "polymorphic";
      readonly alternatives: readonly { readonly sourceType: MojoTargetTypeRef; readonly projection: string }[];
      readonly baseProjection: string;
    }
  | {
      readonly kind: "array";
      readonly element: string;
      readonly sourceCopy: "implicit" | "explicit";
    }
  | {
      readonly kind: "object";
      readonly fields: readonly MojoJsValueField[];
      readonly accessors: readonly MojoJsValueAccessor[];
      readonly identity: "structural" | "project-direct" | "project-erased" | "project-polymorphic";
      readonly sourceCopy: "implicit" | "explicit";
      readonly toJson?: MojoJsValueJsonMethod;
    }
);

export function mojoJsValueGraphTypes(graph: MojoJsValueGraph): readonly MojoTargetTypeRef[] {
  return Object.freeze(graph.definitions.flatMap((definition) => [
    definition.sourceType,
    ...(definition.kind !== "object" || definition.toJson === undefined ? [] : [
      definition.toJson.resultType,
    ]),
    ...(definition.kind !== "object" ? [] : definition.accessors.map((accessor) => accessor.resultType)),
  ]));
}
