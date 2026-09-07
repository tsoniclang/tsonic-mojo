export type MojoDocument =
  | { readonly kind: "empty" }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "concat"; readonly documents: readonly MojoDocument[] }
  | { readonly kind: "line"; readonly flatText: string; readonly hard: boolean }
  | { readonly kind: "indent"; readonly amount: number; readonly document: MojoDocument }
  | { readonly kind: "group"; readonly document: MojoDocument }
  | { readonly kind: "choice"; readonly preferred: MojoDocument; readonly expanded: MojoDocument }
  | {
      readonly kind: "if-break";
      readonly broken: MojoDocument;
      readonly flat: MojoDocument;
    };
