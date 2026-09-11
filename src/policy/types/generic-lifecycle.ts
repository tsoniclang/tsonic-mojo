import { argumentPassingFactKey, pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoLifecycleTraitRole } from "../../target-model/lifecycle/model.js";
import { walkSourceTree } from "../../source/syntax/traversal.js";
import { selectMojoSourceProfileCallRow } from "../operations/source-profile-selection.js";
import type { MojoSourceProfileRegistry } from "./source-profile.js";

export interface MojoGenericLifecycleRequirementContext {
  readonly source: Pick<TargetSourceProgram, "ast" | "navigation" | "sourceFacts">;
  readonly semantics: ReturnType<TargetSourceProgram["semantics"]["forFile"]>;
  readonly sourceProfiles: MojoSourceProfileRegistry;
}

export function mojoSourceGenericLifecycleRequirements(
  owner: Node,
  parameterType: Type,
  context: MojoGenericLifecycleRequirementContext,
): readonly MojoLifecycleTraitRole[] {
  const { ast } = context.source;
  let implicitCopyRequired = false;
  let collectionCopyRequired = false;
  walkSourceTree(owner, ast, (parameter): void => {
    if (!collectionCopyRequired && ast.is.IsCallExpression(parameter)) {
      const pointer = context.source.sourceFacts.getFact(parameter, pointerOperationFactKey);
      const readType = pointer?.operation === "load" ? pointer.pointeeType
        : pointer?.operation === "project-pointer" ? pointer.sourcePointeeType : undefined;
      if (readType !== undefined && context.semantics.types.isIdentical(readType, parameterType)) collectionCopyRequired = true;
    }
    if (!collectionCopyRequired && (ast.is.IsCallExpression(parameter) || ast.is.IsNewExpression(parameter))) {
      const call = context.semantics.operations.call(parameter);
      if (call?.sourceSelectedSignatureKind === "resolved") {
        const selected = selectMojoSourceProfileCallRow(call, context.sourceProfiles, [], {
          ast, semantics: context.semantics,
        });
        if (selected.kind === "selected" && selected.row.restParameterName !== undefined) {
          collectionCopyRequired = call.sourceSelectedSignatureParameters.some((slot) => {
            if (!slot.rest || !context.semantics.types.isArrayLike(slot.selectedType)) return false;
            const elements = context.semantics.types.typeArguments(slot.selectedType);
            return elements.length === 1 && context.semantics.types.isIdentical(elements[0]!, parameterType);
          });
        }
      }
    }
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
    : collectionCopyRequired ? ["copyable", "deinitializable"]
    : ["movable", "deinitializable"]);
}
