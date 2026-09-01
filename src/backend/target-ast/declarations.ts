import type {
  MojoCallArgumentConvention,
  MojoProviderTargetGenericParameter,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoExpression } from "./expressions.js";
import type { MojoStatement } from "./statements.js";

export interface MojoParameter {
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly convention?: MojoCallArgumentConvention;
  readonly defaultValue?: MojoExpression;
  readonly variadic?: boolean;
}

export interface MojoFunctionDeclaration {
  readonly kind: "function";
  readonly name: string;
  readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
  readonly parameters: readonly MojoParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly asynchronous: boolean;
  readonly raises: boolean;
  readonly statements?: readonly MojoStatement[];
  readonly decorators?: readonly string[];
  readonly self?: "self" | "mut self" | "out self" | "owned self";
}

export interface MojoFieldDeclaration {
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly initializer?: MojoExpression;
  readonly compileTime: boolean;
}

export interface MojoStructDeclaration {
  readonly kind: "struct";
  readonly name: string;
  readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
  readonly conformances: readonly MojoTargetTypeRef[];
  readonly fields: readonly MojoFieldDeclaration[];
  readonly methods: readonly MojoFunctionDeclaration[];
  readonly decorators?: readonly string[];
}

export interface MojoTraitDeclaration {
  readonly kind: "trait";
  readonly name: string;
  readonly parents: readonly MojoTargetTypeRef[];
  readonly methods: readonly MojoFunctionDeclaration[];
}

export interface MojoTypeAliasDeclaration {
  readonly kind: "type-alias";
  readonly name: string;
  readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
  readonly value: MojoTargetTypeRef;
}

export interface MojoComptimeDeclaration {
  readonly kind: "comptime";
  readonly name: string;
  readonly genericParameters: readonly MojoProviderTargetGenericParameter[];
  readonly type?: MojoTargetTypeRef;
  readonly initializer: MojoExpression;
}

export type MojoDeclaration =
  | MojoFunctionDeclaration
  | MojoStructDeclaration
  | MojoTraitDeclaration
  | MojoTypeAliasDeclaration
  | MojoComptimeDeclaration;
