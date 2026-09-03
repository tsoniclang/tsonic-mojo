import type { MojoProjectDispatchIndexAdapter } from "../../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
} from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoProjectObjectState,
  mojoProjectObjectType,
} from "./types.js";

export function planMojoIndexAdapterMethods(
  adapter: MojoProjectDispatchIndexAdapter,
  stateType: MojoTargetTypeRef,
  objectName: string,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  registerMojoTypeImports(stateType, context);
  registerMojoTypeImports(adapter.storageType, context);
  const storage: MojoExpression = Object.freeze({
    kind: "member",
    receiver: mojoProjectObjectState(
      Object.freeze({ kind: "path", path: objectName }),
      stateType,
    ),
    name: adapter.storageName,
  });
  const key: MojoExpression = Object.freeze({ kind: "path", path: "key" });
  const objectParameter = Object.freeze({
    name: objectName,
    type: mojoProjectObjectType,
  });
  const methods: MojoFunctionDeclaration[] = [Object.freeze({
    kind: "function",
    name: adapter.readAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      objectParameter,
      Object.freeze({ name: "key", type: adapter.storageType.key }),
    ]),
    resultType: adapter.storageType.value,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({ kind: "element", receiver: storage, index: key }),
    })]),
  })];
  if (adapter.index.write !== undefined) {
    if (adapter.writeAdapterName === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.writeAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        objectParameter,
        Object.freeze({ name: "key", type: adapter.storageType.key }),
        Object.freeze({ name: "value", type: adapter.storageType.value }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({ kind: "element", receiver: storage, index: key }),
        right: Object.freeze({ kind: "path", path: "value" }),
      })]),
    }));
  }
  const destination: MojoExpression = Object.freeze({ kind: "path", path: "destination" });
  methods.push(Object.freeze({
    kind: "function",
    name: adapter.copyAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      objectParameter,
      Object.freeze({
        name: "destination",
        type: adapter.storageType,
        convention: "mut",
      }),
    ]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "for",
      binding: "key",
      iterable: Object.freeze({
        kind: "method-call",
        receiver: storage,
        name: "keys",
        arguments: Object.freeze([]),
      }),
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({ kind: "element", receiver: destination, index: key }),
        right: Object.freeze({ kind: "element", receiver: storage, index: key }),
      })]),
    })]),
  }));
  return Object.freeze(methods);
}
