import type { MojoRuntimePackagePlan } from "../../../analysis/program/model.js";
import type { MojoTargetConfiguration } from "../../../target-model/configuration/model.js";
import type { MojoSourceModule } from "../../target-ast/index.js";

export interface MojoOutputPlan {
  readonly configuration: MojoTargetConfiguration;
  readonly sources: readonly MojoOutputSourceFile[];
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
}

export interface MojoOutputSourceFile {
  readonly path: string;
  readonly module: MojoSourceModule;
}
