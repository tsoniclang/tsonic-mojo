import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoBindingDisposition } from "./model.js";

export interface MojoBindingDispositionInput {
  readonly declaration: Node;
  readonly initializer: Node;
  readonly declarationKind: "const" | "let" | "var" | "using" | "await using";
  readonly type: MojoTargetTypeRef;
  readonly comptime: boolean;
  readonly source: TargetSourceProgram;
}

export function classifyMojoBindingDisposition(
  input: MojoBindingDispositionInput,
): MojoBindingDisposition {
  if (input.comptime) return Object.freeze({ kind: "comptime" });
  const use = input.source.navigation.isProjectDeclaration(input.declaration)
    ? input.source.navigation.declarationUseSummary(input.declaration)
    : undefined;
  const callableKind = directFunctionKind(input, use);
  if (callableKind !== undefined) {
    return Object.freeze({
      kind: "direct-function",
      expression: input.initializer,
      callableKind,
    });
  }
  const mutable = input.declarationKind === "using" ||
    input.declarationKind === "await using" ||
    use?.bindingWritten === true ||
    use?.memberWritten === true ||
    use?.mutatedAfterInitialization === true;
  return Object.freeze({ kind: mutable ? "live-cell" : "immutable-runtime" });
}

function directFunctionKind(
  input: MojoBindingDispositionInput,
  use: ReturnType<TargetSourceProgram["navigation"]["declarationUseSummary"]> | undefined,
): "direct" | "thin" | undefined {
  const { ast } = input.source;
  if (input.declarationKind !== "const" || input.type.kind !== "callable" ||
    (!ast.is.IsArrowFunction(input.initializer) && !ast.is.IsFunctionExpression(input.initializer))) {
    return undefined;
  }
  if (use === undefined || use.bindingWritten || use.memberWritten ||
    use.mutatedAfterInitialization || use.identityCompared || use.aliasedOrStored ||
    use.captured || use.hasUnclassifiedValueUse ||
    use.escapeKinds.some((kind) => kind !== "export")) {
    return undefined;
  }
  return use.firstClassUseCount > 0 ? "thin" : "direct";
}
