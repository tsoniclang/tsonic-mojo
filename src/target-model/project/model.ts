export type MojoOutputType = "bin" | "lib";

export interface MojoCompilerCommandConfiguration {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
}

export interface MojoCompilerPackageConfiguration {
  readonly kind: "standard-library" | "package";
  readonly id: string;
  readonly alias: string;
  readonly packageName: string;
  readonly version: string;
  readonly importRoot: string;
  readonly sourceRoot: string;
}

export interface MojoCompilerProviderConfiguration {
  readonly command: MojoCompilerCommandConfiguration;
  readonly packages: readonly MojoCompilerPackageConfiguration[];
}

export type MojoProjectConfiguration =
  | { readonly kind: "generated" }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export interface MojoTargetConfiguration {
  readonly packageName: string;
  readonly outputType: MojoOutputType;
  readonly project: MojoProjectConfiguration;
  readonly compilerProvider: MojoCompilerProviderConfiguration;
  readonly toolchainVersion: "1.1.0.dev2026083005";
}
