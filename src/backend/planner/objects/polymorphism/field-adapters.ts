import type {
  MojoProjectConcreteDispatch,
  MojoProjectConcreteViewDispatch,
  MojoProjectDispatchFieldAdapter,
} from "../../../../analysis/program/model.js";
import { mojoParameterConvention } from "../../../../analysis/representations/index.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoFunctionDeclaration,
} from "../../../target-ast/index.js";
import { mojoStaticMethodDecorators } from "../../../target-ast/index.js";
import { consumeMojoValue } from "../../expressions/value-plan.js";
import { applyMojoConversion } from "../../expressions/support.js";
import { mojoModuleMemberExpression } from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoMemberPath,
  mojoProjectObjectState,
  mojoProjectObjectType,
  mojoProjectStateType,
  mojoProjectStaticMember,
} from "./types.js";

export function planFieldAdapterMethods(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectDispatchFieldAdapter,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  if (adapter.kind === "stored") return planStoredFieldAdapters(dispatch, adapter, context);
  const methods: MojoFunctionDeclaration[] = [];
  const owner = context.program.projectRelationships.definitionForType(adapter.implementationOwnerType);
  const ownerView = owner === undefined
    ? undefined
    : dispatch.views.find((candidate) => candidate.view.definition === owner);
  if (ownerView === undefined) return undefined;
  const receiver: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(dispatch.concrete.targetType, ownerView.conversionAdapterName),
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({ kind: "path", path: "object" }),
    })]),
  });
  if (adapter.field.read !== undefined && adapter.readAdapterName !== undefined &&
    adapter.readImplementation !== undefined) {
    const name = context.program.projectDispatch.implementationName(
      adapter.readImplementation.declaration,
    );
    if (name === undefined) return undefined;
    let call: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver,
      name,
      arguments: Object.freeze([]),
    });
    if (adapter.field.read.slotType.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    const result = applyMojoConversion(call, adapter.readResultConversion, context);
    if (result === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.readAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([Object.freeze({ name: "object", type: mojoProjectObjectType })]),
      resultType: adapter.readType!,
      asynchronous: adapter.field.read.slotType.asynchronous,
      raises: adapter.field.read.slotType.raises,
      ...(adapter.field.read.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.read.slotType.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({ kind: "return", expression: result })]),
    }));
  }
  if (adapter.field.write !== undefined && adapter.writeAdapterName !== undefined &&
    adapter.writeImplementation !== undefined) {
    const name = context.program.projectDispatch.implementationName(
      adapter.writeImplementation.declaration,
    );
    if (name === undefined) return undefined;
    const value: MojoExpression = Object.freeze({ kind: "path", path: "value" });
    const converted = applyMojoConversion(value, adapter.writeValueConversion, context);
    if (converted === undefined || adapter.writeImplementationParameter === undefined) return undefined;
    const argument = adapter.writeImplementationParameter.disposition.kind === "owned"
      ? consumeMojoValue(
          converted,
          adapter.writeImplementationParameter.callType,
          context.program.lifecycle,
        )
      : converted;
    let call: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver,
      name,
      arguments: Object.freeze([Object.freeze({ value: argument })]),
    });
    if (adapter.field.write.slotType.asynchronous) call = Object.freeze({ kind: "await", expression: call });
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.writeAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "object", type: mojoProjectObjectType }),
        Object.freeze({
          name: "value",
          type: adapter.writeType!,
          convention: adapter.field.write.disposition === undefined
            ? "imm"
            : mojoParameterConvention(adapter.field.write.disposition),
        }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: adapter.field.write.slotType.asynchronous,
      raises: adapter.field.write.slotType.raises,
      ...(adapter.field.write.slotType.errorType === undefined
        ? {}
        : { errorType: adapter.field.write.slotType.errorType }),
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({ kind: "expression", expression: call })]),
    }));
  }
  return Object.freeze(methods);
}

function planStoredFieldAdapters(
  dispatch: MojoProjectConcreteDispatch,
  adapter: Extract<MojoProjectDispatchFieldAdapter, { readonly kind: "stored" }>,
  context: MojoPlanningContext,
): readonly MojoFunctionDeclaration[] | undefined {
  const stateType = mojoProjectStateType(dispatch.concrete);
  if (stateType === undefined) return undefined;
  registerMojoTypeImports(stateType, context);
  const object: MojoExpression = Object.freeze({ kind: "path", path: "object" });
  const storage = mojoMemberPath(mojoProjectObjectState(object, stateType), adapter.statePath);
  const methods: MojoFunctionDeclaration[] = [];
  if (adapter.field.read !== undefined && adapter.readAdapterName !== undefined) {
    const result = applyMojoConversion(storage, adapter.readResultConversion, context);
    if (result === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.readAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([Object.freeze({ name: "object", type: mojoProjectObjectType })]),
      resultType: adapter.readType!,
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({ kind: "return", expression: result })]),
    }));
  }
  if (adapter.field.write !== undefined && adapter.writeAdapterName !== undefined) {
    const value = applyMojoConversion(
      Object.freeze({ kind: "path", path: "value" }),
      adapter.writeValueConversion,
      context,
    );
    if (value === undefined) return undefined;
    methods.push(Object.freeze({
      kind: "function",
      name: adapter.writeAdapterName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([
        Object.freeze({ name: "object", type: mojoProjectObjectType }),
        Object.freeze({ name: "value", type: adapter.writeType! }),
      ]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: false,
      raises: false,
      decorators: mojoStaticMethodDecorators,
      statements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: storage,
        right: value,
      })]),
    }));
  }
  return Object.freeze(methods);
}

export function planDowncastAdapter(
  dispatch: MojoProjectConcreteDispatch,
  adapter: MojoProjectConcreteViewDispatch["downcastAdapters"][number],
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  const resultType: MojoTargetTypeRef = Object.freeze({
    kind: "optional",
    value: mojoProjectObjectType,
  });
  registerMojoTypeImports(resultType, context);
  const targetView = adapter.available
    ? dispatch.views.find((view) => view.view.definition === adapter.route.target)
    : undefined;
  if (adapter.available && targetView === undefined) return undefined;
  const value: MojoExpression = targetView === undefined
    ? Object.freeze({ kind: "construct", type: resultType, arguments: Object.freeze([]) })
    : Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "call",
            callee: mojoModuleMemberExpression(
              context,
              ["tsonic_runtime"],
              "erase_project_view",
            ),
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({
                kind: "call",
                callee: mojoProjectStaticMember(
                  dispatch.concrete.targetType,
                  targetView.conversionAdapterName,
                ),
                arguments: Object.freeze([Object.freeze({
                  value: Object.freeze({ kind: "path", path: "object" }),
                })]),
              }),
            })]),
          }),
        })]),
      });
  return Object.freeze({
    kind: "function",
    name: adapter.adapterName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([Object.freeze({
      name: "object",
      type: mojoProjectObjectType,
    })]),
    resultType,
    asynchronous: false,
    raises: false,
    decorators: mojoStaticMethodDecorators,
    statements: Object.freeze([Object.freeze({ kind: "return", expression: value })]),
  });
}

