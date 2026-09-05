import type {
  MojoExpression,
  MojoFunctionDeclaration,
  MojoGenericParameterDeclaration,
  MojoParameter,
  MojoStatement,
} from "../../target-ast/index.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";

export function mojoErasedStateWrapperInitializer(
  storageType: MojoTargetTypeRef,
): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({ name: "state", type: storageType })]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    self: "out self",
    statements: Object.freeze([Object.freeze({
      kind: "assignment",
      operator: "=",
      left: Object.freeze({
        kind: "member",
        receiver: Object.freeze({ kind: "path", path: "self" }),
        name: "_state",
      }),
      right: Object.freeze({ kind: "path", path: "state" }),
    })]),
  });
}

export function mojoConstructionFactory(input: {
  readonly name: string;
  readonly genericParameters: readonly MojoGenericParameterDeclaration[];
  readonly parameters: readonly MojoParameter[];
  readonly resultType: MojoTargetTypeRef;
  readonly raises: boolean;
  readonly errorType?: MojoTargetTypeRef;
  readonly statements: readonly MojoStatement[];
  readonly result: MojoExpression;
}): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name: input.name,
    genericParameters: input.genericParameters,
    parameters: input.parameters,
    resultType: input.resultType,
    asynchronous: false,
    raises: input.raises,
    ...(input.errorType === undefined ? {} : { errorType: input.errorType }),
    statements: Object.freeze([
      ...input.statements,
      Object.freeze({ kind: "return", expression: input.result }),
    ]),
  });
}
