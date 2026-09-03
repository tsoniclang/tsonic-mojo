import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
} from "../../../target-ast/index.js";

export function mojoProjectIdentityEqualityMethod(
  owner: MojoTargetTypeRef,
): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name: "__eq__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "other",
      type: owner,
      convention: "imm",
    })]),
    resultType: Object.freeze({ kind: "source-primitive", name: "bool" }),
    asynchronous: false,
    raises: false,
    self: "self",
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "method-call",
        receiver: Object.freeze({
          kind: "member",
          receiver: Object.freeze({ kind: "path", path: "self" }),
          name: "_object",
        }),
        name: "same",
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "member",
            receiver: Object.freeze({ kind: "path", path: "other" }),
            name: "_object",
          }),
        })]),
      }),
    })]),
  });
}

export function mojoProjectErrorWritableMethod(
  fallbackName: string,
  messageReadName: string | undefined,
): MojoFunctionDeclaration {
  const message: MojoExpression = messageReadName === undefined
    ? Object.freeze({ kind: "string-literal", value: fallbackName })
    : Object.freeze({
        kind: "method-call",
        receiver: Object.freeze({ kind: "path", path: "self" }),
        name: messageReadName,
        arguments: Object.freeze([]),
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
        arguments: Object.freeze([Object.freeze({ value: message })]),
      }),
    })]),
  });
}
