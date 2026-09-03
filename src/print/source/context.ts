import type { MojoTypeAliasUse } from "../../backend/target-ast/index.js";

export interface MojoPrintContext {
  readonly modulePath: readonly string[];
  readonly aliasesByTypeKey: ReadonlyMap<string, MojoTypeAliasUse>;
  readonly importedSymbols: ReadonlyMap<string, string>;
  readonly expandedAliasKey?: string;
  readonly structTypeParameterIdentities?: ReadonlySet<string>;
}
