import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan } from "../artifact-model/output.js";
import type { MojoDeclaration } from "../target-ast/nodes.js";
import type { MojoPlanningContext } from "./context.js";
import { planMojoFunctionStatements } from "./statements.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoOutput(context: MojoPlanningContext): TargetStageResult<MojoOutputPlan> {
  const declarations: MojoDeclaration[] = [];
  for (const declaration of context.program.declarations) {
    if (declaration.kind !== "function") continue;
    const function_ = declaration;
    for (const parameter of function_.parameters) registerMojoTypeImports(parameter.type, context);
    registerMojoTypeImports(function_.resultType, context);
    const statements = planMojoFunctionStatements(function_, context);
    if (statements === undefined) continue;
    declarations.push(Object.freeze({
      kind: "function",
      name: function_.name,
      genericParameters: Object.freeze(function_.typeParameters.map((parameter) => Object.freeze({
        kind: "type" as const,
        name: parameter.name,
        position: "positional-or-keyword" as const,
        variadic: false,
        constraints: parameter.constraints,
      }))),
      parameters: Object.freeze(function_.parameters.map((parameter) => Object.freeze({
        name: parameter.name,
        type: parameter.type,
        convention: parameter.convention,
        variadic: parameter.rest,
        ...(parameter.optional && parameter.initializer === undefined
          ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
          : {}),
      }))),
      resultType: function_.resultType,
      asynchronous: function_.asynchronous,
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
