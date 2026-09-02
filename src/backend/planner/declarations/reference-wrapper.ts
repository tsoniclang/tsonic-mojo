import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoFunctionDeclaration } from "../../target-ast/index.js";
import type { MojoExpression } from "../../target-ast/index.js";

export function mojoReferenceIdentityEqualityMethod(
  owner: MojoTargetTypeRef,
): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name: "__eq__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "other",
      type: owner,
      convention: "imm" as const,
    })]),
    resultType: Object.freeze({ kind: "source-primitive", name: "bool" }),
    asynchronous: false,
    raises: false,
    self: "self",
    statements: Object.freeze([Object.freeze({
      kind: "return" as const,
      expression: Object.freeze({
        kind: "binary" as const,
        operator: "is",
        left: Object.freeze({
          kind: "member" as const,
          receiver: Object.freeze({ kind: "path" as const, path: "self" }),
          name: "_state",
        }),
        right: Object.freeze({
          kind: "member" as const,
          receiver: Object.freeze({ kind: "path" as const, path: "other" }),
          name: "_state",
        }),
      }),
    })]),
  });
}

export function mojoReferenceErrorWritableMethod(
  fallbackName: string,
  messageFieldName: string | undefined,
): MojoFunctionDeclaration {
  const value: MojoExpression = messageFieldName === undefined
    ? Object.freeze({ kind: "string-literal", value: fallbackName })
    : Object.freeze({
        kind: "member",
        receiver: Object.freeze({
          kind: "postfix-deref",
          expression: Object.freeze({
            kind: "member",
            receiver: Object.freeze({ kind: "path", path: "self" }),
            name: "_state",
          }),
        }),
        name: messageFieldName,
      });
  return Object.freeze({
    kind: "function",
    name: "write_to",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "writer",
      type: Object.freeze({ kind: "compiler-expression", expression: "Some[Writer]" }),
      convention: "mut",
    })]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    self: "self",
    statements: Object.freeze([Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "method-call",
        receiver: Object.freeze({ kind: "path", path: "writer" }),
        name: "write",
        arguments: Object.freeze([Object.freeze({ value })]),
      }),
    })]),
  });
}
