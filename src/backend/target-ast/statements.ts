import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoExpression } from "./expressions.js";

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
      readonly compileTime?: boolean;
    }
  | {
      readonly kind: "tuple-variable";
      readonly names: readonly string[];
      readonly initializer: MojoExpression;
    }
  | {
      readonly kind: "assignment";
      readonly operator: string;
      readonly left: MojoExpression;
      readonly right: MojoExpression;
    }
  | { readonly kind: "expression"; readonly expression: MojoExpression }
  | { readonly kind: "discard"; readonly expression: MojoExpression }
  | {
      readonly kind: "if";
      readonly condition: MojoExpression;
      readonly thenStatements: readonly MojoStatement[];
      readonly elseStatements?: readonly MojoStatement[];
      readonly compileTime?: boolean;
    }
  | {
      readonly kind: "while";
      readonly condition: MojoExpression;
      readonly statements: readonly MojoStatement[];
    }
  | {
      readonly kind: "for";
      readonly binding: string;
      readonly iterable: MojoExpression;
      readonly statements: readonly MojoStatement[];
      readonly compileTime?: boolean;
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
