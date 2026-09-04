import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoOutputSourceFile } from "../../artifact-model/project/output.js";
import type { MojoImportDeclaration } from "../../target-ast/index.js";

export function sortedMojoImports(imports: Iterable<MojoImportDeclaration>): readonly MojoImportDeclaration[] {
  return Object.freeze([...imports].sort((left, right) =>
    left.modulePath.join(".").localeCompare(right.modulePath.join("."), "en") ||
    left.kind.localeCompare(right.kind, "en")));
}

export function duplicateMojoSourcePaths(sources: readonly MojoOutputSourceFile[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.path)) duplicates.add(source.path);
    seen.add(source.path);
  }
  return Object.freeze([...duplicates].sort((left, right) => left.localeCompare(right, "en")));
}

export function mojoOutputPlanningDiagnostic(
  code: string,
  message: string,
  sourceNode?: import("@tsonic/tsts").Node,
): TargetDiagnostic {
  return Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    ...(sourceNode === undefined ? {} : { sourceNode }),
    evidence: Object.freeze(["target.capability=mojo.backend.output-modules"]),
  });
}
