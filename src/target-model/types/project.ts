import type {
  Node,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "./model.js";

export type MojoProjectTypeKind = "class" | "interface" | "enum";

export interface MojoProjectTypeDefinition {
  readonly id: string;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly targetName: string;
  readonly modulePath: readonly string[];
  readonly kind: MojoProjectTypeKind;
  readonly typeParameterNames: readonly string[];
}

export interface MojoProjectTypeIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

export interface MojoProjectTypeCatalog {
  readonly definitions: readonly MojoProjectTypeDefinition[];
  readonly issues: readonly MojoProjectTypeIssue[];
  definitionForDeclaration(declaration: Node | undefined): MojoProjectTypeDefinition | undefined;
  definitionForSymbol(
    symbol: Symbol | undefined,
    declarations: (symbol: Symbol) => readonly Node[],
  ): MojoProjectTypeDefinition | undefined;
  targetTypeForDefinition(
    definition: MojoProjectTypeDefinition,
    arguments_: readonly MojoTargetTypeRef[],
  ): MojoTargetTypeRef | undefined;
}
