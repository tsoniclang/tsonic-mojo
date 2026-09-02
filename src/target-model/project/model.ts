export type MojoOutputType = "bin" | "lib";

export type MojoProjectConfiguration =
  | { readonly kind: "generated" }
  | { readonly kind: "user-owned"; readonly manifestPath: string };
