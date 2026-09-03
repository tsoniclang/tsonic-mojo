export type MojoOriginRef =
  | { readonly kind: "static" }
  | { readonly kind: "comptime" }
  | { readonly kind: "inferred" }
  | { readonly kind: "untracked"; readonly mutable: boolean }
  | { readonly kind: "unsafe"; readonly mutable: boolean }
  | { readonly kind: "parameter"; readonly name: string }
  | {
      readonly kind: "provider-expression";
      readonly tokens: readonly MojoOriginToken[];
    };

export interface MojoOriginToken {
  readonly kind: "identifier" | "number" | "string" | "punctuation";
  readonly text: string;
}
