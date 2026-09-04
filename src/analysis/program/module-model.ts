import type { Node, SourceFile } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoBindingDisposition } from "../representations/model.js";
import type { MojoAnalyzedCallableSignature } from "./model.js";

export interface MojoAnalyzedModuleBinding {
  readonly kind: "module-binding" | "class-static-field" | "function-value";
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly name: string;
  readonly declarationKind: "const" | "let" | "var" | "using" | "await using";
  readonly disposition: MojoBindingDisposition;
  readonly type: MojoTargetTypeRef;
  readonly initializer: Node;
  readonly functionValue?: MojoAnalyzedCallableSignature;
  readonly references?: readonly Node[];
  readonly publicAbi?: MojoPublicModuleBindingAbi;
}

export type MojoPublicModuleBindingAbi =
  | { readonly kind: "callable" }
  | {
      readonly kind: "value";
      readonly copy: "implicit" | "explicit";
    };

export type MojoModuleInitializationStep =
  | {
      readonly kind: "binding";
      readonly binding: MojoAnalyzedModuleBinding;
    }
  | {
      readonly kind: "binding-pattern";
      readonly declaration: Node;
      readonly initializer: Node;
      readonly sourceType: MojoTargetTypeRef;
      readonly bindings: readonly MojoAnalyzedModuleBinding[];
    }
  | {
      readonly kind: "statement";
      readonly statement: Node;
    }
  | {
      readonly kind: "class-static-block";
      readonly declaration: Node;
      readonly body: Node;
      readonly statements: readonly Node[];
    };

export interface MojoAnalyzedModule {
  readonly id: string;
  readonly sourceFile: SourceFile;
  readonly stateName: string;
  readonly createStateName: string;
  readonly cellName: string;
  readonly initializeName: string;
  readonly initializeBodyName: string;
  readonly lifecycleLockName: string;
  readonly lifecycleInitializedName: string;
  readonly bindings: readonly MojoAnalyzedModuleBinding[];
  readonly initializationSteps: readonly MojoModuleInitializationStep[];
  readonly asynchronous: boolean;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly directAsynchronous: boolean;
  readonly directRaises: boolean;
  readonly directErrorType?: MojoTargetTypeRef;
  readonly directRuntimeInitializationRequired: boolean;
  readonly initializationStateRequired: boolean;
  readonly runtimeInitializationRequired: boolean;
}

export interface MojoModuleInitializationComponent {
  readonly id: string;
  readonly ownerModuleId: string;
  readonly memberModuleIds: readonly string[];
  readonly dependencyComponentIds: readonly string[];
  readonly cyclic: boolean;
  readonly asynchronous: boolean;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly directRuntimeInitializationRequired: boolean;
  readonly runtimeInitializationRequired: boolean;
}

export interface MojoModuleInitializationCatalog {
  readonly components: readonly MojoModuleInitializationComponent[];
  componentForId(id: string): MojoModuleInitializationComponent | undefined;
  componentForModuleId(moduleId: string): MojoModuleInitializationComponent | undefined;
}


