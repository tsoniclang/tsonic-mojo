import type { MojoRuntimePackagePlan } from "../../../analysis/program/model.js";
import type { MojoTargetConfiguration } from "../../../target-model/configuration/model.js";
import type { MojoSourceModule } from "../../target-ast/index.js";
import type { MojoNativeBuildPlan } from "./native.js";

export interface MojoOutputPlan {
  readonly configuration: MojoTargetConfiguration;
  readonly components: readonly MojoOutputComponent[];
  readonly sources: readonly MojoOutputSourceFile[];
  readonly runtimePackages: readonly MojoRuntimePackagePlan[];
  readonly nativeBuild: MojoNativeBuildPlan;
}

export interface MojoOutputComponent {
  readonly id: string;
  readonly packageName: string;
  readonly root: boolean;
  readonly dependencies: readonly string[];
  readonly artifactKey: string;
  readonly initializer?: MojoOutputComponentInitializer;
}

export interface MojoOutputComponentInitializer {
  readonly modulePath: readonly string[];
  readonly name: string;
  readonly asynchronous: boolean;
  readonly raises: boolean;
}

export interface MojoOutputSourceFile {
  readonly componentId: string;
  readonly path: string;
  readonly module: MojoSourceModule;
}
