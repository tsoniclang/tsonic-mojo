import { argumentPassingFactKey } from "@tsonic/tsts";
import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoLifecycleTraitRole } from "../../target-model/lifecycle/model.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";

export interface MojoGenericLifecycleRequirementContext {
  readonly source: Pick<TargetSourceProgram, "ast" | "navigation" | "sourceFacts">;
  readonly semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>;
}

export function mojoSourceGenericLifecycleRequirements(
  owner: Node,
  parameterType: Type,
  context: MojoGenericLifecycleRequirementContext,
): readonly MojoLifecycleTraitRole[] {
  const { ast } = context.source;
  let implicitCopyRequired = false;
  walkSourceTree(owner, ast, (parameter): void => {
    if (implicitCopyRequired || !ast.is.IsParameterDeclaration(parameter)) return;
    const selected = context.semantics.declarations.declaredValueType(parameter) ??
      context.semantics.declarations.declaredType(parameter);
    if (selected === undefined || !context.semantics.types.isIdentical(selected, parameterType)) {
      return;
    }
    const mode = context.source.sourceFacts.getFact(parameter, argumentPassingFactKey)?.mode;
    if (mode !== undefined && mode !== "by-value" && mode !== "byref-readonly") return;
    const use = context.source.navigation.parameterUseSummary(parameter);
    implicitCopyRequired ||= use?.bindingWritten === true || use?.captured === true ||
      use?.uses.some((entry) =>
        !entry.throughMember && (entry.role === "return" || entry.role === "storage")) === true;
  });
  return Object.freeze(implicitCopyRequired
    ? ["implicitly-copyable", "deinitializable"]
    : ["movable", "deinitializable"]);
}
