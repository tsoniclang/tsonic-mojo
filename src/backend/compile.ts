import { runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import type { TargetCompileResult } from "@tsonic/target-api/artifacts";
import { analyzeMojoTargetProgram } from "../analysis/program/index.js";
import type { MojoTargetAnalysisRequest } from "../analysis/program/index.js";
import { materializeMojoOutputPlan } from "./emission/materialize.js";
import { createMojoPlanningContext } from "./planner/context.js";
import { planMojoOutput } from "./planner/program.js";

export function compileMojoTarget(request: MojoTargetAnalysisRequest): TargetCompileResult {
  return runTargetCompilationStages({
    analyze: () => analyzeMojoTargetProgram(request),
    plan: (program) => planMojoOutput(createMojoPlanningContext(program)),
    materialize: materializeMojoOutputPlan,
  });
}
