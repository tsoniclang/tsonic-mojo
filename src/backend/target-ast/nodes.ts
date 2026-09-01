import type {
  MojoCallArgumentConvention,
  MojoProviderTargetGenericParameter,
  MojoTargetTypeRef,
} from "../../target-model/provider/model.js";

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

export type MojoExpression =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "number-literal"; readonly text: string }
  | { readonly kind: "bool-literal"; readonly value: boolean }
  | { readonly kind: "none-literal" }
  | { readonly kind: "tuple"; readonly elements: readonly MojoExpression[] }
  | { readonly kind: "list"; readonly elements: readonly MojoExpression[] }
  | { readonly kind: "dictionary"; readonly entries: readonly MojoDictionaryEntry[] }
  | { readonly kind: "unary"; readonly operator: string; readonly operand: MojoExpression }
  | {
      readonly kind: "binary";
      readonly operator: string;
      readonly left: MojoExpression;
      readonly right: MojoExpression;
    }
  | {
      readonly kind: "conditional";
      readonly condition: MojoExpression;
      readonly whenTrue: MojoExpression;
      readonly whenFalse: MojoExpression;
    }
  | {
      readonly kind: "call";
      readonly callee: MojoExpression;
      readonly genericArguments?: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[];
      readonly arguments: readonly MojoCallArgument[];
    }
  | {
      readonly kind: "method-call";
      readonly receiver: MojoExpression;
      readonly name: string;
      readonly genericArguments?: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[];
      readonly arguments: readonly MojoCallArgument[];
    }
  | { readonly kind: "member"; readonly receiver: MojoExpression; readonly name: string }
  | { readonly kind: "element"; readonly receiver: MojoExpression; readonly index: MojoExpression }
  | {
      readonly kind: "slice";
      readonly receiver: MojoExpression;
      readonly start?: MojoExpression;
      readonly end?: MojoExpression;
      readonly step?: MojoExpression;
    }
  | {
      readonly kind: "construct";
      readonly type: MojoTargetTypeRef;
      readonly genericArguments?: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[];
      readonly arguments: readonly MojoCallArgument[];
    }
  | { readonly kind: "consume"; readonly expression: MojoExpression }
  | { readonly kind: "postfix-deref"; readonly expression: MojoExpression }
  | { readonly kind: "await"; readonly expression: MojoExpression }
  | { readonly kind: "parenthesized"; readonly expression: MojoExpression }
  | {
      readonly kind: "lambda";
      readonly parameters: readonly MojoParameter[];
      readonly captures: readonly MojoLambdaCapture[];
      readonly resultType: MojoTargetTypeRef;
      readonly raises: boolean;
      readonly expression: MojoExpression;
    };

export interface MojoLambdaCapture {
  readonly name: string;
  readonly convention: "imm" | "mut";
}

export interface MojoDictionaryEntry {
  readonly key: MojoExpression;
  readonly value: MojoExpression;
}

export interface MojoCallArgument {
  readonly value: MojoExpression;
  readonly name?: string;
  readonly spread?: boolean;
}

export interface MojoCatchClause {
  readonly name?: string;
  readonly statements: readonly MojoStatement[];
}

export type MojoStatement =
  | { readonly kind: "return"; readonly expression?: MojoExpression }
  | {
      readonly kind: "variable";
      readonly name: string;
      readonly type?: MojoTargetTypeRef;
      readonly initializer?: MojoExpression;
    }
  | { readonly kind: "assignment"; readonly operator: string; readonly left: MojoExpression; readonly right: MojoExpression }
  | { readonly kind: "expression"; readonly expression: MojoExpression }
  | {
      readonly kind: "if";
      readonly condition: MojoExpression;
      readonly thenStatements: readonly MojoStatement[];
      readonly elseStatements?: readonly MojoStatement[];
    }
  | { readonly kind: "while"; readonly condition: MojoExpression; readonly statements: readonly MojoStatement[] }
  | {
      readonly kind: "for";
      readonly binding: string;
      readonly iterable: MojoExpression;
      readonly statements: readonly MojoStatement[];
    }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "pass" }
  | { readonly kind: "raise"; readonly expression?: MojoExpression }
  | {
      readonly kind: "try";
      readonly statements: readonly MojoStatement[];
      readonly catches: readonly MojoCatchClause[];
      readonly finallyStatements?: readonly MojoStatement[];
    }
  | {
      readonly kind: "with";
      readonly expression: MojoExpression;
      readonly binding?: string;
      readonly statements: readonly MojoStatement[];
    };

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

export interface MojoSourceModule {
  readonly modulePath: readonly string[];
  readonly imports: readonly MojoImportDeclaration[];
  readonly declarations: readonly MojoDeclaration[];
}
