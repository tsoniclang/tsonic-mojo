export type MojoImportDeclaration =
  | {
      readonly kind: "module";
      readonly modulePath: readonly string[];
      readonly alias?: string;
    }
  | {
      readonly kind: "symbols";
      readonly modulePath: readonly string[];
      readonly symbols: readonly MojoImportedSymbol[];
    };

export interface MojoImportedSymbol {
  readonly name: string;
  readonly alias?: string;
}
