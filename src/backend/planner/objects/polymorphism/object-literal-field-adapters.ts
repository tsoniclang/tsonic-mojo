import type {
  MojoCallableExpressionSelection,
  MojoProjectObjectLiteralFieldAdapter,
  MojoProjectObjectLiteralViewDispatch,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStatement,
} from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import { consumeMojoValue } from "../../expressions/value-plan.js";
import { applyMojoConversion } from "../../expressions/support.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStaticMember,
} from "./types.js";

export function planObjectFieldAdapters(
  adapter: MojoProjectObjectLiteralFieldAdapter,
  implementationNames: ReadonlyMap<MojoCallableExpressionSelection, string>,
  stateType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const methods: MojoFunctionDeclaration[] = [];
  const object: MojoExpression = Object.freeze({ kind: "path", path: "_object" });
  const state = mojoProjectObjectState(object, stateType);
  if (adapter.kind === "stored") {
    const storage: MojoExpression = Object.freeze({
      kind: "member",
      receiver: state,
      name: adapter.stateName,
    });
    if (adapter.readAdapterName !== undefined && adapter.readType !== undefined &&
      adapter.readResultConversion !== undefined) {
      const value = applyMojoConversion(storage, adapter.readResultConversion, context);
      if (value === undefined) return undefined;
      methods.push(staticFieldAdapter(
        adapter.readAdapterName,
        Object.freeze([]),
        adapter.readType,
        Object.freeze({ kind: "return", expression: value }),
      ));
    }
    if (adapter.writeAdapterName !== undefined && adapter.writeType !== undefined &&
      adapter.writeValueConversion !== undefined) {
      const value = applyMojoConversion(
        Object.freeze({ kind: "path", path: "value" }),
        adapter.writeValueConversion,
        context,
      );
      if (value === undefined) return undefined;
      methods.push(staticFieldAdapter(
        adapter.writeAdapterName,
        Object.freeze([Object.freeze({
          name: "value",
          type: adapter.writeType,
          convention: adapter.field.write?.disposition === undefined
            ? "imm"
            : mojoParameterConvention(adapter.field.write.disposition),
        })]),
        Object.freeze({ kind: "unit" }),
        Object.freeze({ kind: "assignment", operator: "=", left: storage, right: value }),
      ));
    }
    return Object.freeze(methods);
  }
  if (adapter.readAdapterName !== undefined && adapter.readImplementation !== undefined &&
    adapter.readType !== undefined && adapter.readResultConversion !== undefined) {
    const name = implementationNames.get(adapter.readImplementation);
    if (name === undefined) return undefined;
    let call: MojoExpression = Object.freeze({
      kind: "call",
      callee: mojoProjectStaticMember(stateType, name),
      arguments: Object.freeze([Object.freeze({ value: object })]),
    });
    if (adapter.readImplementation.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    const result = applyMojoConversion(call, adapter.readResultConversion, context);
    if (result === undefined) return undefined;
    methods.push(Object.freeze({
      ...staticFieldAdapter(
        adapter.readAdapterName,
        Object.freeze([]),
        adapter.readType,
        Object.freeze({ kind: "return", expression: result }),
      ),
      asynchronous: adapter.readImplementation.asynchronous,
      raises: adapter.field.read?.slotType.raises === true,
      ...(adapter.field.read?.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.read.slotType.errorType }),
    }));
  }
  if (adapter.writeAdapterName !== undefined && adapter.writeImplementation !== undefined &&
    adapter.writeType !== undefined && adapter.writeValueConversion !== undefined) {
    const name = implementationNames.get(adapter.writeImplementation);
    const parameter = adapter.writeImplementation.parameters[0];
    const converted = applyMojoConversion(
      Object.freeze({ kind: "path", path: "value" }),
      adapter.writeValueConversion,
      context,
    );
    if (name === undefined || parameter === undefined || converted === undefined) return undefined;
    const argument = mojoParameterConvention(parameter.disposition) === "var"
      ? consumeMojoValue(converted, parameter.callType, context.program.lifecycle)
      : converted;
    let call: MojoExpression = Object.freeze({
      kind: "call",
      callee: mojoProjectStaticMember(stateType, name),
      arguments: Object.freeze([
        Object.freeze({ value: object }),
        Object.freeze({ value: argument }),
      ]),
    });
    if (adapter.writeImplementation.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    methods.push(Object.freeze({
      ...staticFieldAdapter(
        adapter.writeAdapterName,
        Object.freeze([Object.freeze({
          name: "value",
          type: adapter.writeType,
          convention: adapter.field.write?.disposition === undefined
            ? "imm"
            : mojoParameterConvention(adapter.field.write.disposition),
        })]),
        Object.freeze({ kind: "unit" }),
        Object.freeze({ kind: "expression", expression: call }),
      ),
      asynchronous: adapter.writeImplementation.asynchronous,
      raises: adapter.field.write?.slotType.raises === true,
      ...(adapter.field.write?.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.write.slotType.errorType }),
    }));
  }
  return Object.freeze(methods);
}

function staticFieldAdapter(
  name: string,
  parameters: readonly import("../../../target-ast/index.js").MojoParameter[],
  resultType: MojoTargetTypeRef,
  statement: MojoStatement,
): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([
      Object.freeze({ name: "_object", type: mojoProjectObjectType, convention: "imm" }),
      ...parameters,
    ]),
    resultType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([statement]),
  });
}

export function planObjectDowncastAdapter(
  adapter: MojoProjectObjectLiteralViewDispatch["downcastAdapters"][number],
  context: MojoPlanningContext,
): MojoFunctionDeclaration {
  const resultType: MojoTargetTypeRef = Object.freeze({
    kind: "optional",
    value: adapter.route.targetType,
  });
  registerMojoTypeImports(resultType, context);
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "_object",
      type: mojoProjectObjectType,
    })]),
    resultType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([]),
      }),
    })]),
  });
}


