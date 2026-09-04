import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoPlanningContext } from "./context.js";

export function optionalMojoModuleType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value });
}

export function appendMojoModulePlanningFailure(
  context: MojoPlanningContext,
  previousDiagnosticCount: number,
  code: string,
  message: string,
  sourceNode: import("@tsonic/tsts").Node,
): void {
  if (context.diagnostics.length !== previousDiagnosticCount) return;
  context.diagnostics.push(Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    sourceNode,
    evidence: Object.freeze(["target.capability=mojo.backend.module-initialization"]),
  }));
}
