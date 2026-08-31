export type MojoOutputType = "bin" | "lib";

export type MojoProjectConfiguration =
  | { readonly kind: "generated" }
  | { readonly kind: "user-owned"; readonly manifestPath: string };

export interface MojoTargetConfiguration {
  readonly packageName: string;
  readonly outputType: MojoOutputType;
  readonly project: MojoProjectConfiguration;
  readonly toolchainVersion: "1.1.0.dev2026083005";
}
