import type { MojoJsValueGraph } from "../../target-model/conversions/js-value-graph.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoProjectDispatchPlan, MojoAnalyzedFunction } from "../program/model.js";
import type { Node } from "@tsonic/tsts";
import { closeMojoErrorType, mojoNativeErrorType } from "../../target-model/types/error-domains.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";

export function sourceValueProjectionIssues(
  graphs: readonly MojoJsValueGraph[],
  dispatch: MojoProjectDispatchPlan,
  relationships: MojoProjectTypeRelationships,
  implementations: WeakMap<Node, MojoAnalyzedFunction>,
): readonly { readonly node: Node; readonly code: string; readonly message: string }[] {
  const issues = new Map<Node, { readonly node: Node; readonly code: string; readonly message: string }>();
  for (const graph of graphs) {
    for (const projection of graph.definitions) {
      if (projection.kind === "object") {
        for (const method of [...projection.accessors, ...(projection.toJson === undefined ? [] : [projection.toJson])]) {
          const implementation = implementations.get(method.declaration);
          const errorType = implementation?.raises === true ? closeMojoErrorType([
            implementation.errorType ?? mojoNativeErrorType(),
          ]) : undefined;
          if (implementation === undefined || errorType !== undefined && !mojoTargetTypeEquals(errorType, mojoNativeErrorType())) {
            issues.set(method.declaration, Object.freeze({ node: method.declaration,
              code: implementation === undefined ? "MOJO_SOURCE_VALUE_METHOD_UNCLOSED" : "MOJO_SOURCE_VALUE_ERROR_DOMAIN_UNSUPPORTED",
              message: implementation === undefined ?
              "A selected source-value method has no finalized implementation." :
              "A selected source-value method raises an error carrier not admitted by the native JSON callback ABI.",
            }));
          }
        }
      }
      if (projection.kind !== "polymorphic") continue;
      for (const alternative of projection.alternatives) {
        if (dispatch.downcastFor(projection.sourceType, alternative.sourceType) !== undefined) continue;
        const owner = relationships.definitionForType(projection.sourceType);
        if (owner === undefined) throw new Error("A source-value graph lost its analyzed project owner.");
        issues.set(owner.declaration, Object.freeze({ node: owner.declaration,
          code: "MOJO_SOURCE_VALUE_DISPATCH_UNCLOSED",
          message: "A polymorphic source-value projection has no exact closed concrete downcast route.",
        }));
      }
    }
  }
  return Object.freeze([...issues.values()]);
}
