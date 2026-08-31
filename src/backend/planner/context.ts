import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetProgram } from "../../analysis/program/model.js";

export interface MojoPlanningContext {
  readonly program: MojoTargetProgram;
  readonly diagnostics: TargetDiagnostic[];
  readonly imports: Set<string>;
}

export function createMojoPlanningContext(program: MojoTargetProgram): MojoPlanningContext {
  return { program, diagnostics: [], imports: new Set<string>() };
}

export function appendMojoPlanningDiagnostic(
  context: MojoPlanningContext,
  code: string,
  message: string,
  sourceNode: Node,
): void {
  context.diagnostics.push(Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    sourceNode,
    evidence: Object.freeze(["target.capability=mojo.backend.planning"]),
  }));
}
