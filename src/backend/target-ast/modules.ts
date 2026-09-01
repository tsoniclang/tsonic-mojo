import type { MojoDeclaration } from "./declarations.js";
import type { MojoImportDeclaration } from "./imports.js";

export interface MojoSourceModule {
  readonly modulePath: readonly string[];
  readonly imports: readonly MojoImportDeclaration[];
  readonly declarations: readonly MojoDeclaration[];
}
