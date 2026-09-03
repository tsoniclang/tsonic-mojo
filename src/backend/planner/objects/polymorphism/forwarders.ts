import type {
  MojoProjectDispatchCallableVariant,
  MojoProjectDispatchField,
  MojoProjectDispatchView,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoFieldDeclaration,
  MojoFunctionDeclaration,
} from "../../../target-ast/index.js";
import { consumeMojoValue } from "../../expressions/value-plan.js";
import {
  withMojoErrorType,
  withMojoLocalNameScope,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import {
  planMojoParameterDeclaration,
  planMojoParameterPrelude,
} from "../../declarations/parameters.js";
import { planMojoValue } from "../../expressions/value.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import { mojoProjectObjectType } from "./types.js";

export function mojoProjectViewFields(
  view: MojoProjectDispatchView,
  context: MojoPlanningContext,
): readonly MojoFieldDeclaration[] {
  registerMojoTypeImports(mojoProjectObjectType, context);
  const fields: MojoFieldDeclaration[] = [Object.freeze({
    name: "_object",
    type: mojoProjectObjectType,
    compileTime: false,
  })];
  for (const callable of view.callables) {
    registerMojoTypeImports(callable.slotType, context);
    fields.push(Object.freeze({
      name: callable.slotName,
      type: callable.slotType,
      compileTime: false,
    }));
    for (const access of [callable.property?.read, callable.property?.write]) {
      if (access === undefined) continue;
      registerMojoTypeImports(access.slotType, context);
      fields.push(Object.freeze({
        name: access.slotName,
        type: access.slotType,
        compileTime: false,
      }));
    }
  }
  for (const field of view.fields) {
    for (const access of [field.read, field.write]) {
      if (access === undefined) continue;
      registerMojoTypeImports(access.slotType, context);
      fields.push(Object.freeze({
        name: access.slotName,
        type: access.slotType,
        compileTime: false,
      }));
    }
  }
  for (const conversion of view.conversions) {
    registerMojoTypeImports(conversion.slotType, context);
    fields.push(Object.freeze({
      name: conversion.slotName,
      type: conversion.slotType,
      compileTime: false,
    }));
  }
  return Object.freeze(fields);
}

export function planMojoProjectViewForwarders(
  view: MojoProjectDispatchView,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const methods: MojoFunctionDeclaration[] = [];
  for (const callable of view.callables) {
    const planned = planCallableForwarder(callable, context);
    if (planned === undefined) return undefined;
    methods.push(planned);
    if (callable.property?.read !== undefined) {
      methods.push(Object.freeze({
        kind: "function",
        name: callable.property.read.name,
        genericParameters: Object.freeze([]),
        parameters: Object.freeze([]),
        resultType: callable.property.callableType,
        asynchronous: false,
        raises: false,
        self: "self",
        statements: Object.freeze([Object.freeze({
          kind: "return",
          expression: slotCall(callable.property.read.slotName, Object.freeze([])),
        })]),
      }));
    }
    if (callable.property?.write !== undefined) {
      methods.push(Object.freeze({
        kind: "function",
        name: callable.property.write.name,
        genericParameters: Object.freeze([]),
        parameters: Object.freeze([Object.freeze({
          name: "value",
          type: callable.property.callableType,
        })]),
        resultType: Object.freeze({ kind: "unit" }),
        asynchronous: false,
        raises: false,
        self: "self",
        statements: Object.freeze([Object.freeze({
          kind: "expression",
          expression: slotCall(callable.property.write.slotName, Object.freeze([
            Object.freeze({ value: Object.freeze({ kind: "path", path: "value" }) }),
          ])),
        })]),
      }));
    }
  }
  for (const field of view.fields) {
    if (field.read !== undefined) methods.push(planFieldRead(field));
    if (field.write !== undefined) methods.push(planFieldWrite(field, context));
  }
  for (const conversion of view.conversions) {
    methods.push(Object.freeze({
      kind: "function",
      name: conversion.name,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([]),
      resultType: conversion.targetType,
      asynchronous: false,
      raises: false,
      self: "self",
      statements: Object.freeze([Object.freeze({
        kind: "return",
        expression: slotCall(conversion.slotName, Object.freeze([])),
      })]),
    }));
  }
  return Object.freeze(methods);
}

export function planMojoProjectViewInitializer(
  view: MojoProjectDispatchView,
): MojoFunctionDeclaration {
  const slotFields = [
    ...view.callables.flatMap((entry) => [
      Object.freeze({ name: entry.slotName, type: entry.slotType }),
      ...[entry.property?.read, entry.property?.write].flatMap((access) =>
        access === undefined
          ? []
          : [Object.freeze({ name: access.slotName, type: access.slotType })]),
    ]),
    ...view.fields.flatMap((field) => [field.read, field.write].flatMap((entry) =>
      entry === undefined ? [] : [Object.freeze({ name: entry.slotName, type: entry.slotType })])),
    ...view.conversions.map((entry) => Object.freeze({ name: entry.slotName, type: entry.slotType })),
  ];
  return Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, position: "keyword" }),
      ...slotFields.map((field) => Object.freeze({
        name: field.name,
        type: field.type,
        position: "keyword" as const,
      })),
    ]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    self: "out self",
    statements: Object.freeze([
      "_object",
      ...slotFields.map((field) => field.name),
    ].map((name) => Object.freeze({
      kind: "assignment" as const,
      operator: "=",
      left: Object.freeze({
        kind: "member" as const,
        receiver: Object.freeze({ kind: "path" as const, path: "self" }),
        name,
      }),
      right: Object.freeze({ kind: "path" as const, path: name }),
    }))),
  });
}

function planCallableForwarder(
  callable: MojoProjectDispatchCallableVariant,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const functionContext = withMojoErrorType(withMojoLocalNameScope(context), callable.errorType);
  const prelude = planMojoParameterPrelude(callable.parameters, functionContext, planMojoValue, true);
  if (prelude === undefined) return undefined;
  const arguments_ = callable.parameters.map((parameter): MojoCallArgument => {
    const value: MojoExpression = Object.freeze({ kind: "path", path: parameter.name });
    return Object.freeze({
      value: parameter.disposition.kind === "owned" ||
          parameter.disposition.kind === "immutable" && parameter.disposition.localCopy
        ? consumeMojoValue(value, parameter.bodyType, context.program.lifecycle)
        : value,
    });
  });
  let call = slotCall(callable.slotName, Object.freeze(arguments_));
  if (callable.contract.asynchronous) call = Object.freeze({ kind: "await", expression: call });
  return Object.freeze({
    kind: "function",
    name: callable.name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(callable.parameters.map((parameter) =>
      planMojoParameterDeclaration(parameter, context))),
    resultType: callable.resultType,
    asynchronous: callable.contract.asynchronous,
    raises: callable.contract.raises,
    ...(callable.errorType === undefined ? {} : { errorType: callable.errorType }),
    self: "self",
    statements: Object.freeze([
      ...prelude,
      callable.resultType.kind === "unit"
        ? Object.freeze({ kind: "expression" as const, expression: call })
        : Object.freeze({ kind: "return" as const, expression: call }),
    ]),
  });
}

function planFieldRead(field: MojoProjectDispatchField): MojoFunctionDeclaration {
  const read = field.read!;
  let call = slotCall(read.slotName, Object.freeze([]));
  if (read.slotType.asynchronous) call = Object.freeze({ kind: "await", expression: call });
  return Object.freeze({
    kind: "function",
    name: read.name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([]),
    resultType: read.valueType,
    asynchronous: read.slotType.asynchronous,
    raises: read.slotType.raises,
    ...(read.slotType.errorType === undefined ? {} : { errorType: read.slotType.errorType }),
    self: "self",
    statements: Object.freeze([Object.freeze({ kind: "return", expression: call })]),
  });
}

function planFieldWrite(
  field: MojoProjectDispatchField,
  context: MojoPlanningContext,
): MojoFunctionDeclaration {
  const write = field.write!;
  const value: MojoExpression = Object.freeze({ kind: "path", path: "value" });
  const argument = write.disposition?.kind === "owned"
    ? consumeMojoValue(value, write.valueType, context.program.lifecycle)
    : value;
  let call = slotCall(write.slotName, Object.freeze([Object.freeze({ value: argument })]));
  if (write.slotType.asynchronous) call = Object.freeze({ kind: "await", expression: call });
  return Object.freeze({
    kind: "function",
    name: write.name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "value",
      type: write.valueType,
      convention: write.disposition === undefined
        ? "imm"
        : mojoParameterConvention(write.disposition),
    })]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: write.slotType.asynchronous,
    raises: write.slotType.raises,
    ...(write.slotType.errorType === undefined ? {} : { errorType: write.slotType.errorType }),
    self: "self",
    statements: Object.freeze([Object.freeze({ kind: "expression", expression: call })]),
  });
}

function slotCall(
  slotName: string,
  arguments_: readonly MojoCallArgument[],
): MojoExpression {
  const self: MojoExpression = Object.freeze({ kind: "path", path: "self" });
  return Object.freeze({
    kind: "call",
    callee: Object.freeze({ kind: "member", receiver: self, name: slotName }),
    arguments: Object.freeze([
      Object.freeze({
        value: Object.freeze({ kind: "member", receiver: self, name: "_object" }),
      }),
      ...arguments_,
    ]),
  });
}
