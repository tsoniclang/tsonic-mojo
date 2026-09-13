import type { MojoTargetTypeRef } from "../types/model.js";

export type MojoValueIterationTarget =
  | "native-values"
  | "js-array-live-values"
  | "js-array-values"
  | "js-map-entries"
  | "js-set-values"
  | "js-string-values";

export interface MojoClosedIterationContract {
  readonly target: MojoValueIterationTarget | "dictionary-keys";
  readonly elementType: MojoTargetTypeRef;
}
