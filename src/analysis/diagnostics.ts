import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";

export function mojoAnalysisDiagnostic(
  code: string,
  message: string,
  sourceNode: Node,
): TargetDiagnostic {
  return Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    sourceNode,
    evidence: Object.freeze(["target.capability=mojo.backend.foundation"]),
  });
}
