import { rejectedTargetStage, runTargetCompilationStages } from "@tsonic/target-api/artifacts";
import type { TargetCompileResult } from "@tsonic/target-api/artifacts";
import { analyzeMojoTargetProgram } from "../analysis/program/index.js";
import type { MojoTargetAnalysisRequest } from "../analysis/program/index.js";
import { materializeMojoOutputPlan } from "./emission/materialize.js";
import { planMojoOutput } from "./planner/program/plan.js";
import { createMojoOutputPlanningContext } from "./planner/program/context.js";
import { MojoFormattingError } from "./emission/mojo-format.js";

export function compileMojoTarget(request: MojoTargetAnalysisRequest): TargetCompileResult {
  try {
    return runTargetCompilationStages({
      analyze: () => analyzeMojoTargetProgram(request),
      plan: (program) => planMojoOutput(createMojoOutputPlanningContext(program)),
      materialize: materializeMojoOutputPlan,
    });
  } catch (error) {
    if (!(error instanceof MojoFormattingError)) throw error;
    return rejectedTargetStage([{
      code: "MOJO_SOURCE_FORMATTING_FAILED",
      category: "error",
      source: "tsonic-mojo",
      message: error.message,
      evidence: ["target.capability=mojo.toolchain.format"],
    }]);
  }
}
