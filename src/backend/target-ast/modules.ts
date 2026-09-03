import type { MojoDeclaration } from "./declarations.js";
import type { MojoImportDeclaration } from "./imports.js";
import type { MojoTargetGenericArgument } from "../../target-model/types/model.js";

export interface MojoTypeAliasUse {
  readonly typeKey: string;
  readonly name: string;
  readonly genericArguments: readonly MojoTargetGenericArgument[];
}

export interface MojoSourceModule {
  readonly modulePath: readonly string[];
  readonly imports: readonly MojoImportDeclaration[];
  readonly typeAliases: readonly MojoTypeAliasUse[];
  readonly declarations: readonly MojoDeclaration[];
}
