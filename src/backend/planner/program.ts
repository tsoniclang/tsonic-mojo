import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan } from "../artifact-model/output.js";
import type { MojoDeclaration } from "../target-ast/nodes.js";
import type { MojoPlanningContext } from "./context.js";
import { planMojoFunctionStatements } from "./statements.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoOutput(context: MojoPlanningContext): TargetStageResult<MojoOutputPlan> {
  const declarations: MojoDeclaration[] = [];
  for (const function_ of context.program.functions) {
    for (const parameter of function_.parameters) registerMojoTypeImports(parameter.type, context);
    registerMojoTypeImports(function_.resultType, context);
    const statements = planMojoFunctionStatements(function_, context);
    if (statements === undefined) continue;
    declarations.push(Object.freeze({
      kind: "function",
      name: function_.name,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze(function_.parameters.map((parameter) => Object.freeze({
        name: parameter.name,
        type: parameter.type,
      }))),
      resultType: function_.resultType,
      asynchronous: false,
      raises: function_.raises,
      statements,
    }));
  }
  if (context.diagnostics.length > 0) return rejectedTargetStage(context.diagnostics);
  return resolvedTargetStage(Object.freeze({
    configuration: context.program.configuration,
    module: Object.freeze({
      imports: Object.freeze([...context.imports.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([, declaration]) => declaration)),
      declarations: Object.freeze(declarations),
    }),
    runtimePackages: context.program.runtimePackages,
  }));
}
