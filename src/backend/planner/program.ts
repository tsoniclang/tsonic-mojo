import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan } from "../artifact-model/output.js";
import type { MojoFunctionDeclaration } from "../target-ast/nodes.js";
import type { MojoPlanningContext } from "./context.js";
import { planMojoFunctionStatements } from "./statements.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoOutput(context: MojoPlanningContext): TargetStageResult<MojoOutputPlan> {
  const functions: MojoFunctionDeclaration[] = [];
  for (const function_ of context.program.functions) {
    for (const parameter of function_.parameters) registerMojoTypeImports(parameter.type, context);
    registerMojoTypeImports(function_.resultType, context);
    const statements = planMojoFunctionStatements(function_, context);
    if (statements === undefined) continue;
    functions.push(Object.freeze({
      name: function_.name,
      parameters: Object.freeze(function_.parameters.map((parameter) => Object.freeze({
        name: parameter.name,
        type: parameter.type,
      }))),
      resultType: function_.resultType,
      raises: function_.raises,
      statements,
    }));
  }
  if (context.diagnostics.length > 0) return rejectedTargetStage(context.diagnostics);
  return resolvedTargetStage(Object.freeze({
    configuration: context.program.configuration,
    module: Object.freeze({
      imports: Object.freeze([...context.imports].sort((left, right) => left.localeCompare(right, "en"))),
      functions: Object.freeze(functions),
    }),
    runtimePackages: context.program.runtimePackages,
  }));
}
