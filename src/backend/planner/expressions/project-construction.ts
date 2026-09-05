import type { MojoProjectConstruction } from "../../../analysis/program/model.js";
import type { MojoCallArgument, MojoExpression } from "../../target-ast/index.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";

export function planMojoProjectConstruction(
  construction: MojoProjectConstruction,
  arguments_: readonly MojoCallArgument[],
  context: MojoPlanningContext,
): MojoExpression {
  registerMojoTypeImports(construction.type, context);
  if (construction.kind === "initializer") {
    return Object.freeze({ kind: "construct", type: construction.type, arguments: arguments_ });
  }
  return Object.freeze({
    kind: "call",
    callee: mojoModuleMemberExpression(context, construction.modulePath, construction.name),
    ...(construction.genericArguments.length === 0
      ? {}
      : { genericArguments: construction.genericArguments }),
    arguments: arguments_,
  });
}
