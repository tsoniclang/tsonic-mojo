import type {
  MojoProjectObjectLiteralCallableAdapter,
} from "../../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoStatement,
} from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import { mojoModuleMemberExpression } from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { planMojoParameterDeclaration } from "../../declarations/parameters.js";
import { applyMojoConversion } from "../../expressions/support.js";
import { consumeMojoValue } from "../../expressions/value-plan.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStaticMember,
} from "./types.js";
import { planMojoCallableAdapterArguments } from "../../callables/parameter-adapters.js";

export function planObjectCallableAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  implementationName: string,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (adapter.implementation === undefined) return undefined;
  const parameters = adapter.parameters.map((parameter) =>
    planMojoParameterDeclaration(parameter, context));
  const adapted = planMojoCallableAdapterArguments(adapter.parameterAdapters, context);
  if (adapted === undefined) return undefined;
  const arguments_: MojoCallArgument[] = [
    Object.freeze({ value: Object.freeze({ kind: "path", path: "_object" }) }),
    ...adapted.arguments,
  ];
  let call: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, implementationName),
    ...(adapter.genericArguments.length === 0
      ? {}
      : { genericArguments: adapter.genericArguments }),
    arguments: Object.freeze(arguments_),
  });
  if (adapter.implementation.asynchronous) {
    call = Object.freeze({ kind: "await", expression: call });
  }
  const result = applyMojoConversion(call, adapter.resultConversion, context);
  if (result === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
      ...parameters,
    ]),
    resultType: adapter.resultType,
    asynchronous: adapter.variant.contract.asynchronous,
    raises: adapter.raises,
    ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([
      ...adapted.before,
      adapter.resultType.kind === "unit"
        ? Object.freeze({ kind: "expression", expression: call })
        : Object.freeze({ kind: "return", expression: result }),
    ]),
  });
}

export function planObjectMethodPropertyAdapters(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  implementationName: string | undefined,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const property = adapter.variant.property;
  const storage = adapter.methodStorage;
  if (property === undefined && storage === undefined) return Object.freeze([]);
  if (adapter.variant.contract.asynchronous) return undefined;
  const direct = implementationName === undefined
    ? undefined
    : objectDirectMethodCall(adapter, stateType, context);
  if (storage?.initialization.kind === "default" && direct === undefined) return undefined;
  const methods: MojoFunctionDeclaration[] = [];
  if (storage !== undefined) {
    if (adapter.methodCallAdapterName === undefined) return undefined;
    const stored = objectMethodStorageExpression(stateType, storage.name);
    const storedCall = objectErasedMethodCall(stored, adapter, context);
    if (storedCall === undefined) return undefined;
    const statements: MojoStatement[] = storage.initialization.kind === "spread"
      ? [objectMethodCallStatement(storedCall, adapter.resultType)]
      : direct === undefined
        ? []
        : [Object.freeze({
            kind: "if" as const,
            condition: stored,
            thenStatements: Object.freeze([
              objectMethodCallStatement(storedCall, adapter.resultType),
            ]),
            elseStatements: Object.freeze([
              objectMethodCallStatement(direct, adapter.resultType),
            ]),
          })];
    if (statements.length === 0) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.methodCallAdapterName,
      genericParameters: Object.freeze([]),
      parameters: objectMethodAdapterParameters(adapter, context),
      resultType: adapter.resultType,
      asynchronous: false,
      raises: adapter.raises,
      ...(adapter.errorType === undefined ? {} : { errorType: adapter.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze(statements),
    }));
  }
  if (property?.read !== undefined) {
    if (adapter.methodReadAdapterName === undefined) return undefined;
    if (storage?.initialization.kind === "spread") {
      methods.push(objectSpreadMethodReadAdapter(adapter, stateType));
    } else {
      if (implementationName === undefined || adapter.methodBindAdapterName === undefined) {
        return undefined;
      }
      const binding = planObjectMethodBindingAdapter(adapter, stateType, context);
      const read = planObjectMethodReadAdapter(adapter, stateType, context);
      if (binding === undefined || read === undefined) return undefined;
      methods.push(binding, read);
    }
  }
  if (property?.write !== undefined) {
    if (storage === undefined || adapter.methodWriteAdapterName === undefined) return undefined;
    const optionalType = storage.storageType;
    registerMojoTypeImports(optionalType, context);
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.methodWriteAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
        Object.freeze({ name: "value", type: storage.callableType, convention: "imm" }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: objectMethodStorageExpression(stateType, storage.name),
        right: Object.freeze({
          kind: "construct",
          type: optionalType,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "path", path: "value" }),
          })]),
        }),
      })]),
    }));
  }
  return Object.freeze(methods);
}

function planObjectMethodBindingAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const property = adapter.variant.property;
  if (property === undefined || adapter.methodBindAdapterName === undefined) return undefined;
  const argumentsType: MojoTargetTypeRef = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(property.callableType.parameters.map((parameter) => parameter.type)),
  });
  registerMojoTypeImports(argumentsType, context);
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "_object" }),
  })];
  for (const [index, parameter] of adapter.parameters.entries()) {
    const value: MojoExpression = Object.freeze({
      kind: "element",
      receiver: Object.freeze({ kind: "path", path: "arguments" }),
      index: Object.freeze({ kind: "number-literal", text: String(index) }),
    });
    arguments_.push(Object.freeze({
      value: parameter.disposition.kind === "owned"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    }));
  }
  const call: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, adapter.adapterName),
    arguments: Object.freeze(arguments_),
  });
  return Object.freeze({
    kind: "function",
    name: adapter.methodBindAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
      Object.freeze({ name: "arguments", type: argumentsType, convention: "var" }),
    ]),
    resultType: adapter.resultType,
    asynchronous: false,
    raises: property.callableType.raises,
    ...(property.callableType.errorType === undefined
      ? {}
      : { errorType: property.callableType.errorType }),
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([objectMethodCallStatement(call, adapter.resultType)]),
  });
}

function planObjectMethodReadAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const property = adapter.variant.property;
  if (property?.read === undefined || adapter.methodReadAdapterName === undefined ||
    adapter.methodBindAdapterName === undefined) return undefined;
  registerMojoTypeImports(property.callableType, context);
  const statements: MojoStatement[] = [];
  if (adapter.methodStorage !== undefined) {
    const stored = objectMethodStorageExpression(stateType, adapter.methodStorage.name);
    statements.push(Object.freeze({
      kind: "if",
      condition: stored,
      thenStatements: Object.freeze([Object.freeze({
        kind: "return",
        expression: Object.freeze({
          kind: "method-call",
          receiver: stored,
          name: "value",
          arguments: Object.freeze([]),
        }),
      })]),
    }));
  }
  statements.push(Object.freeze({
    kind: "return",
    expression: Object.freeze({
      kind: "call",
      callee: mojoModuleMemberExpression(
        context,
        ["tsonic_runtime"],
        property.callableType.raises
          ? "bind_raising_project_callable"
          : "bind_project_callable",
      ),
      arguments: Object.freeze([
        Object.freeze({ value: Object.freeze({ kind: "path", path: "_object" }) }),
        Object.freeze({ value: mojoProjectStaticMember(stateType, adapter.methodBindAdapterName) }),
      ]),
    }),
  }));
  return Object.freeze({
    kind: "function",
    name: adapter.methodReadAdapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
      type: mojoProjectObjectType,
      convention: "imm",
    })]),
    resultType: property.callableType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze(statements),
  });
}

function objectSpreadMethodReadAdapter(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
): MojoFunctionDeclaration {
  const property = adapter.variant.property!;
  const storage = adapter.methodStorage!;
  return Object.freeze({
    kind: "function",
    name: adapter.methodReadAdapterName!,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
      type: mojoProjectObjectType,
      convention: "imm",
    })]),
    resultType: property.callableType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "method-call",
        receiver: objectMethodStorageExpression(stateType, storage.name),
        name: "value",
        arguments: Object.freeze([]),
      }),
    })]),
  });
}

function objectDirectMethodCall(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression {
  const arguments_: MojoCallArgument[] = [Object.freeze({
    value: Object.freeze({ kind: "path", path: "_object" }),
  })];
  for (const parameter of adapter.parameters) {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.incomingName });
    arguments_.push(Object.freeze({
      value: parameter.disposition.kind === "owned"
        ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
        : value,
      ...(parameter.omissionKind === "rest" ? { spread: true } : {}),
    }));
  }
  return Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, adapter.adapterName),
    arguments: Object.freeze(arguments_),
  });
}

function objectErasedMethodCall(
  optional: MojoExpression,
  adapter: MojoProjectObjectLiteralCallableAdapter,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (adapter.methodStorage === undefined) return undefined;
  const values = adapter.parameters.map((parameter): MojoExpression => {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.incomingName });
    return parameter.disposition.kind === "owned"
      ? consumeMojoValue(value, parameter.callType, context.program.lifecycle)
      : value;
  });
  return Object.freeze({
    kind: "method-call",
    receiver: Object.freeze({
      kind: "method-call",
      receiver: optional,
      name: "value",
      arguments: Object.freeze([]),
    }),
    name: "call",
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({ kind: "tuple", elements: Object.freeze(values) }),
    })]),
  });
}

function objectMethodAdapterParameters(
  adapter: MojoProjectObjectLiteralCallableAdapter,
  context: MojoPlanningContext,
): readonly MojoParameter[] {
  return Object.freeze([
    Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
    ...adapter.parameters.map((parameter) => planMojoParameterDeclaration(parameter, context)),
  ]);
}

function objectMethodCallStatement(
  call: MojoExpression,
  resultType: MojoTargetTypeRef,
): MojoStatement {
  return resultType.kind === "unit"
    ? Object.freeze({ kind: "expression", expression: call })
    : Object.freeze({ kind: "return", expression: call });
}

function objectMethodStorageExpression(
  stateType: MojoTargetTypeRef,
  name: string,
): MojoExpression {
  return Object.freeze({
    kind: "member",
    receiver: mojoProjectObjectState(
      Object.freeze({ kind: "path", path: "_object" }),
      stateType,
    ),
    name,
  });
}

