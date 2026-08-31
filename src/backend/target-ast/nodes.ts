import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";

export type MojoExpression =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "string-literal"; readonly value: string }
  | { readonly kind: "number-literal"; readonly text: string }
  | { readonly kind: "bool-literal"; readonly value: boolean }
  | { readonly kind: "binary"; readonly operator: string; readonly left: MojoExpression; readonly right: MojoExpression }
  | { readonly kind: "call"; readonly callee: MojoExpression; readonly arguments: readonly MojoCallArgument[] }
  | { readonly kind: "method-call"; readonly receiver: MojoExpression; readonly name: string; readonly arguments: readonly MojoCallArgument[] }
  | { readonly kind: "member"; readonly receiver: MojoExpression; readonly name: string }
  | { readonly kind: "construct"; readonly type: MojoTargetTypeRef; readonly arguments: readonly MojoCallArgument[] }
  | { readonly kind: "consume"; readonly expression: MojoExpression }
  | { readonly kind: "parenthesized"; readonly expression: MojoExpression };

export interface MojoCallArgument {
  readonly value: MojoExpression;
  readonly name?: string;
}

export type MojoStatement =
  | { readonly kind: "return"; readonly expression?: MojoExpression }
  | { readonly kind: "variable"; readonly name: string; readonly type: MojoTargetTypeRef; readonly initializer: MojoExpression }
  | { readonly kind: "assignment"; readonly operator: string; readonly left: MojoExpression; readonly right: MojoExpression }
  | { readonly kind: "expression"; readonly expression: MojoExpression }
  | { readonly kind: "if"; readonly condition: MojoExpression; readonly thenStatements: readonly MojoStatement[]; readonly elseStatements?: readonly MojoStatement[] }
  | { readonly kind: "while"; readonly condition: MojoExpression; readonly statements: readonly MojoStatement[] };

export interface MojoFunctionDeclaration {
  readonly name: string;
  readonly parameters: readonly { readonly name: string; readonly type: MojoTargetTypeRef }[];
  readonly resultType: MojoTargetTypeRef;
  readonly raises: boolean;
  readonly statements: readonly MojoStatement[];
}

export interface MojoSourceModule {
  readonly imports: readonly string[];
  readonly functions: readonly MojoFunctionDeclaration[];
}
