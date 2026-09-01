import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoFunctionDeclaration } from "../../target-ast/index.js";

export function mojoReferenceCopyInitializer(): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "copy",
      type: Object.freeze({
        kind: "target-named" as const,
        id: "mojo.builtin.Self",
        modulePath: Object.freeze([]),
        name: "Self",
      }),
      convention: "imm" as const,
      position: "keyword" as const,
    })]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    self: "out self",
    statements: Object.freeze([Object.freeze({
      kind: "assignment" as const,
      operator: "=" as const,
      left: Object.freeze({
        kind: "member" as const,
        receiver: Object.freeze({ kind: "path" as const, path: "self" }),
        name: "_state",
      }),
      right: Object.freeze({
        kind: "member" as const,
        receiver: Object.freeze({ kind: "path" as const, path: "copy" }),
        name: "_state",
      }),
    })]),
  });
}

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
