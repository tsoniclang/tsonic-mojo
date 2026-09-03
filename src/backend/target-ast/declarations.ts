import type {
  MojoCallArgumentConvention,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoExpression } from "./expressions.js";
import type { MojoStatement } from "./statements.js";

export interface MojoParameter {
  readonly name: string;
  readonly type: MojoTargetTypeRef;
  readonly convention?: MojoCallArgumentConvention;
  readonly position?: "positional" | "positional-or-keyword" | "keyword";
  readonly defaultValue?: MojoExpression;
  readonly variadic?: boolean;
}

export interface MojoGenericParameterDeclaration {
  readonly kind: "type" | "value" | "origin";
  readonly name: string;
  readonly identity?: string;
  readonly position: "positional" | "positional-or-keyword" | "keyword" | "inferred";
  readonly variadic: boolean;
  readonly constraints: readonly MojoTargetTypeRef[];
  readonly defaultArgument?: MojoTargetGenericArgument;
}

export type MojoDecorator = "fieldwise-init" | "static-method";

export const mojoFieldwiseInitDecorators = Object.freeze(["fieldwise-init"] as const);
export const mojoStaticMethodDecorators = Object.freeze(["static-method"] as const);

export interface MojoFunctionDeclaration {
  readonly kind: "function";
  readonly name: string;
  readonly genericParameters: readonly MojoGenericParameterDeclaration[];
  readonly parameters: readonly MojoParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly asynchronous: boolean;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly statements?: readonly MojoStatement[];
  readonly decorators?: readonly MojoDecorator[];
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
  readonly genericParameters: readonly MojoGenericParameterDeclaration[];
  readonly conformances: readonly MojoTargetTypeRef[];
  readonly fields: readonly MojoFieldDeclaration[];
  readonly methods: readonly MojoFunctionDeclaration[];
  readonly decorators?: readonly MojoDecorator[];
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
  readonly genericParameters: readonly MojoGenericParameterDeclaration[];
  readonly value: MojoTargetTypeRef;
  readonly aliasedTypeKey?: string;
}

export interface MojoComptimeDeclaration {
  readonly kind: "comptime";
  readonly name: string;
  readonly genericParameters: readonly MojoGenericParameterDeclaration[];
  readonly type?: MojoTargetTypeRef;
  readonly initializer: MojoExpression;
}

export type MojoDeclaration =
  | MojoFunctionDeclaration
  | MojoStructDeclaration
  | MojoTraitDeclaration
  | MojoTypeAliasDeclaration
  | MojoComptimeDeclaration;
