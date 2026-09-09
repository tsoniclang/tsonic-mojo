import type { MojoJsValueGraph } from "../../target-model/conversions/js-value-graph.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoProjectDispatchPlan } from "../program/model.js";
import type { Node } from "@tsonic/tsts";

export function sourceValueDispatchIssues(
  graphs: readonly MojoJsValueGraph[],
  dispatch: MojoProjectDispatchPlan,
  relationships: MojoProjectTypeRelationships,
): readonly { readonly node: Node; readonly message: string }[] {
  const issues = new Map<Node, { readonly node: Node; readonly message: string }>();
  for (const graph of graphs) {
    for (const projection of graph.definitions) {
      if (projection.kind !== "polymorphic") continue;
      for (const alternative of projection.alternatives) {
        if (dispatch.downcastFor(projection.sourceType, alternative.sourceType) !== undefined) continue;
        const owner = relationships.definitionForType(projection.sourceType);
        if (owner === undefined) throw new Error("A source-value graph lost its analyzed project owner.");
        issues.set(owner.declaration, Object.freeze({ node: owner.declaration,
          message: "A polymorphic source-value projection has no exact closed concrete downcast route.",
        }));
      }
    }
  }
  return Object.freeze([...issues.values()]);
}
