import type {
  Node,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import type { MojoTargetGenericArgument, MojoTargetTypeRef } from "./model.js";

export type MojoProjectTypeKind = "class" | "interface" | "enum";

export interface MojoProjectTypeParameterDefinition {
  readonly declaration: Node;
  readonly identity: string;
  readonly name: string;
  readonly kind: "type" | "value" | "origin";
}

export interface MojoProjectTypeDefinition {
  readonly id: string;
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly sourceName: string;
  readonly targetName: string;
  readonly modulePath: readonly string[];
  readonly kind: MojoProjectTypeKind;
  readonly typeParameters: readonly MojoProjectTypeParameterDefinition[];
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
  definitionForId(id: string): MojoProjectTypeDefinition | undefined;
  definitionForSymbol(
    symbol: Symbol | undefined,
    declarations: (symbol: Symbol) => readonly Node[],
  ): MojoProjectTypeDefinition | undefined;
  targetTypeForDefinition(
    definition: MojoProjectTypeDefinition,
    arguments_: readonly MojoTargetGenericArgument[],
  ): MojoTargetTypeRef | undefined;
}
