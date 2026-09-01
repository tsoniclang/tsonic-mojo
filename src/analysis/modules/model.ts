import type { Node, SourceFile } from "@tsonic/tsts";

export interface MojoSourceModuleDependency {
  readonly kind: "import" | "export";
  readonly declaration: Node;
  readonly moduleSpecifier: Node;
  readonly target: MojoSourceModuleReference;
}

export interface MojoSourceModuleReference {
  readonly id: string;
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly modulePath: readonly string[];
}

export interface MojoSourceModuleExport {
  readonly exportName: string;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
}

export interface MojoSourceModuleDefinition {
  readonly id: string;
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly relativeSourcePath: string;
  readonly packageId: string;
  readonly componentId: string;
  readonly packageName: string;
  readonly moduleSegments: readonly string[];
  readonly modulePath: readonly string[];
  readonly artifactPath: string;
  readonly dependencies: readonly MojoSourceModuleDependency[];
  readonly exports: readonly MojoSourceModuleExport[];
  readonly topLevelAwait: boolean;
  readonly runtimeInitializationRequired: boolean;
  readonly entryPoint: boolean;
}

export interface MojoSourcePackageDefinition {
  readonly componentId: string;
  readonly packageName: string;
  readonly root: boolean;
  readonly moduleDirectories: readonly (readonly string[])[];
}

export interface MojoSourceModuleCatalog {
  readonly definitions: readonly MojoSourceModuleDefinition[];
  readonly packages: readonly MojoSourcePackageDefinition[];
  readonly entryPoint: MojoSourceModuleDefinition;
  forSourceFile(sourceFile: SourceFile | undefined): MojoSourceModuleDefinition | undefined;
  forFileName(fileName: string): MojoSourceModuleDefinition | undefined;
}

export interface MojoSourceModuleIssue {
  readonly code: string;
  readonly message: string;
  readonly node?: Node;
}

export type MojoSourceModuleAnalysis =
  | {
      readonly kind: "resolved";
      readonly catalog: MojoSourceModuleCatalog;
    }
  | {
      readonly kind: "rejected";
      readonly issues: readonly MojoSourceModuleIssue[];
    };
