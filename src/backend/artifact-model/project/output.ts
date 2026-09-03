import type { MojoRuntimePackagePlan } from "../../../analysis/program/model.js";
import type { MojoTargetConfiguration } from "../../../target-model/configuration/model.js";
import type { MojoSourceModule } from "../../target-ast/index.js";

export interface MojoOutputPlan {
  readonly configuration: MojoTargetConfiguration;
  readonly components: readonly MojoOutputComponent[];
  readonly sources: readonly MojoOutputSourceFile[];
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
}

export interface MojoOutputComponent {
  readonly id: string;
  readonly packageName: string;
  readonly root: boolean;
  readonly dependencies: readonly string[];
  readonly artifactKey: string;
}

export interface MojoOutputSourceFile {
  readonly componentId: string;
  readonly path: string;
  readonly module: MojoSourceModule;
}
