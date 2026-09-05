import type {
  Node,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import type { SourceProjectMemberImplementationResult } from "@tsonic/target-api/source";
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

export interface MojoProjectHeritageEdge {
  readonly kind: "extends" | "implements";
  readonly source: MojoProjectTypeDefinition;
  readonly target: MojoProjectTypeDefinition;
  readonly heritage: Node;
  readonly targetType: MojoTargetTypeRef;
}

export type MojoProjectTypeRelationship =
  | { readonly kind: "related"; readonly targetType: MojoTargetTypeRef }
  | { readonly kind: "unrelated" }
  | { readonly kind: "ambiguous"; readonly targetTypes: readonly MojoTargetTypeRef[] };

export interface MojoProjectTypeRelationships {
  readonly definitions: readonly MojoProjectTypeDefinition[];
  readonly issues: readonly MojoProjectTypeIssue[];
  definitionContainingDeclaration(declaration: Node | undefined): MojoProjectTypeDefinition | undefined;
  definitionForType(type: MojoTargetTypeRef | undefined): MojoProjectTypeDefinition | undefined;
  openType(definition: MojoProjectTypeDefinition): MojoTargetTypeRef;
  heritageForDefinition(definition: MojoProjectTypeDefinition): readonly MojoProjectHeritageEdge[];
  directSupertypes(type: MojoTargetTypeRef): readonly MojoTargetTypeRef[] | undefined;
  relationship(
    source: MojoTargetTypeRef,
    target: MojoProjectTypeDefinition,
  ): MojoProjectTypeRelationship;
  instantiateType(
    definition: MojoProjectTypeDefinition,
    instance: MojoTargetTypeRef,
    type: MojoTargetTypeRef,
  ): MojoTargetTypeRef | undefined;
  instantiateGenericArguments(
    definition: MojoProjectTypeDefinition,
    instance: MojoTargetTypeRef,
    arguments_: readonly MojoTargetGenericArgument[],
  ): readonly MojoTargetGenericArgument[] | undefined;
  instantiateMemberType(
    member: Node,
    receiver: MojoTargetTypeRef,
    declaredType: MojoTargetTypeRef,
  ): MojoTargetTypeRef | undefined;
  isPolymorphic(definition: MojoProjectTypeDefinition): boolean;
  classLineage(
    definition: MojoProjectTypeDefinition,
  ): readonly MojoProjectTypeDefinition[] | undefined;
  interfacesForClass(
    definition: MojoProjectTypeDefinition,
  ): readonly MojoProjectTypeDefinition[] | undefined;
  concreteClassesFor(
    definition: MojoProjectTypeDefinition,
  ): readonly MojoProjectTypeDefinition[];
  memberImplementation(
    concreteClass: MojoProjectTypeDefinition,
    contractMember: Node,
  ): SourceProjectMemberImplementationResult;
}
