import type { Node } from "@tsonic/tsts";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoQualifiedModuleMember,
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  convertMojoValue,
  finishOptionalMojoOperation,
  orderCallArguments,
  orderMojoValues,
  planSelectedArgument,
  prepareMojoReceiver,
  requiredMojoTypeName,
  unsupportedOptionalCall,
} from "./support.js";
import type {
  MojoValuePlanner,
  PlannedMojoCallArgument,
} from "./support.js";
import { registerMojoTypeImports } from "../types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import type { MojoCallableArgumentSlot } from "../../../analysis/program/call-model.js";

export function planMojoCall(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.callSelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(context, "MOJO_CALL_PLAN_MISSING", "Call expression has no sealed target selection.", node);
    return undefined;
  }
  if (selection.kind === "explicit-safety") {
    return selection.form === "remaining-block"
      ? mojoValue(Object.freeze({ kind: "tuple", elements: Object.freeze([]) }))
      : planValue(selection.expression, context, selection.resultType);
  }
  if (selection.kind === "native-pointer") {
    registerMojoTypeImports(selection.pointerType, context);
    const pointer = planValue(selection.pointerExpression, context, selection.pointerType);
    if (pointer === undefined) return undefined;
    if (selection.operation === "load") {
      return withMojoValue(pointer.before, Object.freeze({
        kind: "postfix-deref",
        expression: pointer.value,
      }));
    }
    if (selection.operation === "offset") {
      const offset = planValue(selection.offsetExpression, context, selection.offsetType);
      if (offset === undefined) return undefined;
      const ordered = orderMojoValues([
        Object.freeze({ plan: pointer, type: selection.pointerType, role: "native_pointer" }),
        Object.freeze({ plan: offset, type: selection.offsetType, role: "native_pointer_offset" }),
      ], context);
      return withMojoValue(ordered.before, Object.freeze({
        kind: "method-call",
        receiver: ordered.values[0]!,
        name: "unsafe_offset",
        arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
      }));
    }
    const value = planValue(selection.valueExpression, context, selection.valueType);
    if (value === undefined) return undefined;
    const ordered = orderMojoValues([
      Object.freeze({ plan: pointer, type: selection.pointerType, role: "native_pointer" }),
      Object.freeze({ plan: value, type: selection.valueType, role: "native_pointer_value" }),
    ], context);
    return withMojoValue(Object.freeze([
      ...ordered.before,
      Object.freeze({
        kind: "assignment" as const,
        left: Object.freeze({
          kind: "postfix-deref" as const,
          expression: ordered.values[0]!,
        }),
        operator: "=" as const,
        right: ordered.values[1]!,
      }),
    ]), Object.freeze({ kind: "tuple", elements: Object.freeze([]) }));
  }
  if (selection.kind === "raw-pointer") {
    registerMojoModuleImport(context, Object.freeze(["tsonic_runtime"]));
    if (selection.operation === "bind") {
      const identity = planValue(selection.identityExpression, context, selection.identityType);
      return identity === undefined
        ? undefined
        : withMojoValue(identity.before, Object.freeze({
            kind: "call",
            callee: Object.freeze({ kind: "path", path: "tsonic_runtime.raw_pointer_from_arc" }),
            arguments: Object.freeze([Object.freeze({
              value: Object.freeze({ kind: "member", receiver: identity.value, name: "_state" }),
            })]),
          }));
    }
    if (selection.operation === "equal") {
      const left = planValue(selection.leftExpression, context, selection.leftType);
      const right = planValue(selection.rightExpression, context, selection.rightType);
      if (left === undefined || right === undefined) return undefined;
      const ordered = orderMojoValues([
        Object.freeze({ plan: left, type: selection.leftType, role: "raw_pointer_left" }),
        Object.freeze({ plan: right, type: selection.rightType, role: "raw_pointer_right" }),
      ], context);
      return withMojoValue(ordered.before, Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: "tsonic_runtime.equal_raw_pointer" }),
        arguments: Object.freeze(ordered.values.map((value) => Object.freeze({ value }))),
      }));
    }
    const pointer = planValue(selection.pointerExpression, context, selection.pointerType);
    return pointer === undefined
      ? undefined
      : withMojoValue(pointer.before, Object.freeze({
          kind: "call",
          callee: Object.freeze({ kind: "path", path: "tsonic_runtime.hash_raw_pointer" }),
          arguments: Object.freeze([Object.freeze({ value: pointer.value })]),
        }));
  }
  if (selection.kind === "typed-location") {
    registerMojoTypeImports(selection.locationType, context);
    switch (selection.operation) {
      case "address-of": {
        const storage = context.program.queries.locationStorage(selection.storageDeclaration);
        if (storage === undefined) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_POINTER_STORAGE_PLAN_MISSING",
            "Address-of has no sealed promoted Mojo storage.",
            node,
          );
          return undefined;
        }
        return mojoValue(Object.freeze({ kind: "path", path: storage.name }));
      }
      case "allocate": {
        const initial = planValue(selection.initialExpression, context, selection.pointeeType);
        return initial === undefined
          ? undefined
          : withMojoValue(initial.before, Object.freeze({
              kind: "construct",
              type: selection.locationType,
              arguments: Object.freeze([Object.freeze({ value: initial.value })]),
            }));
      }
      case "load": {
        const pointer = planValue(selection.pointerExpression, context, selection.locationType);
        return pointer === undefined
          ? undefined
          : withMojoValue(pointer.before, Object.freeze({
              kind: "method-call",
              receiver: pointer.value,
              name: "read",
              arguments: Object.freeze([]),
            }));
      }
      case "store": {
        const pointer = planValue(selection.pointerExpression, context, selection.locationType);
        const value = planValue(selection.valueExpression, context, selection.pointeeType);
        if (pointer === undefined || value === undefined) return undefined;
        const ordered = orderMojoValues([
          Object.freeze({ plan: pointer, type: selection.locationType, role: "location_pointer" }),
          Object.freeze({ plan: value, type: selection.pointeeType, role: "location_value" }),
        ], context);
        return withMojoValue(ordered.before, Object.freeze({
          kind: "method-call",
          receiver: ordered.values[0]!,
          name: "write",
          arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
        }));
      }
      case "equal-pointer": {
        const left = planValue(selection.leftExpression, context, selection.locationType);
        const right = planValue(selection.rightExpression, context, selection.locationType);
        if (left === undefined || right === undefined) return undefined;
        const ordered = orderMojoValues([
          Object.freeze({ plan: left, type: selection.locationType, role: "location_left" }),
          Object.freeze({ plan: right, type: selection.locationType, role: "location_right" }),
        ], context);
        return withMojoValue(ordered.before, Object.freeze({
          kind: "method-call",
          receiver: ordered.values[0]!,
          name: "same_storage",
          arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
        }));
      }
    }
  }
  if (selection.kind === "project") {
    const arguments_ = selection.arguments.map((argument) => planSelectedArgument(argument, context, planValue));
    if (arguments_.some((argument) => argument === undefined)) return undefined;
    const plannedArguments = arguments_ as PlannedMojoCallArgument[];
    let call: MojoExpression;
    let before: readonly MojoStatement[];
    switch (selection.target.kind) {
      case "function": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "call",
          callee: {
            kind: "path",
            path: mojoQualifiedModuleMember(context, selection.target.modulePath, selection.target.name),
          },
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: ordered.arguments,
        };
        break;
      }
      case "method": {
        const receiver = prepareMojoReceiver(
          selection.target.receiver,
          selection.target.receiverType,
          selection.optionalChain,
          context,
          planValue,
        );
        if (receiver === undefined) return undefined;
        const ordered = orderCallArguments(plannedArguments, context, Object.freeze({
          plan: receiver.plan,
          type: selection.target.receiverType,
          role: "call_receiver",
        }));
        before = ordered.before;
        call = {
          kind: "method-call",
          receiver: ordered.receiver!,
          name: selection.target.name,
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: ordered.arguments,
        };
        const converted = convertMojoValue(withMojoValue(before, call), selection.resultConversion, context);
        if (converted === undefined) return undefined;
        return finishOptionalMojoOperation(node, receiver, converted, context);
      }
      case "static-method": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        registerMojoTypeImports(selection.target.owner, context);
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "method-call",
          receiver: { kind: "path", path: requiredMojoTypeName(selection.target.owner, context) },
          name: selection.target.name,
          ...(selection.genericArguments.length === 0 ? {} : { genericArguments: selection.genericArguments }),
          arguments: ordered.arguments,
        };
        break;
      }
      case "constructor": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        registerMojoTypeImports(selection.target.type, context);
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = { kind: "construct", type: selection.target.type, arguments: ordered.arguments };
        break;
      }
    }
    return convertMojoValue(withMojoValue(before, call), selection.resultConversion, context);
  }
  if (selection.kind === "callable") {
    if (selection.optionalChain) return unsupportedOptionalCall(node, context);
    const callee = planValue(selection.callee, context);
    const arguments_ = selection.argumentSlots.map((slot) =>
      planCallableArgumentSlot(slot, context, planValue));
    if (callee === undefined || arguments_.some((argument) => argument === undefined)) return undefined;
    const ordered = orderCallArguments(
      arguments_ as PlannedMojoCallArgument[],
      context,
      Object.freeze({ plan: callee, type: selection.callableType, role: "callable_value" }),
    );
    if (ordered.arguments.some((argument) => argument.name !== undefined || argument.spread === true)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_ERASED_CALLABLE_ARGUMENT_ABI_UNSUPPORTED",
        "A retained Mojo callable invocation requires exact positional non-spread arguments.",
        node,
      );
      return undefined;
    }
    const call: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver: ordered.receiver!,
      name: "call",
      arguments: Object.freeze([Object.freeze({
        value: Object.freeze({
          kind: "tuple",
          elements: Object.freeze(ordered.arguments.map((argument) => argument.value)),
        }),
      })]),
    });
    return convertMojoValue(withMojoValue(ordered.before, call), selection.resultConversion, context);
  }
  const target = selection.operation.target;
  if (target.kind !== "function-call" && target.kind !== "instance-call") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_CALL_FORM_INVALID",
      `Provider call selected non-call target form '${target.kind}'.`,
      node,
    );
    return undefined;
  }
  const arguments_ = selection.arguments.map((argument) => planSelectedArgument(argument, context, planValue));
  if (arguments_.some((argument) => argument === undefined)) return undefined;
  const plannedArguments = arguments_ as PlannedMojoCallArgument[];
  let call: MojoExpression;
  let before: readonly MojoStatement[];
  if (target.kind === "function-call") {
    if (selection.optionalChain) return unsupportedOptionalCall(node, context);
    registerMojoModuleImport(context, target.modulePath);
    let receiver: ReturnType<typeof prepareMojoReceiver>;
    let convertedReceiver: MojoValuePlan | undefined;
    if (target.receiver !== undefined) {
      if (selection.receiver === undefined || selection.sourceReceiverType === undefined ||
        selection.operation.receiverType === undefined || selection.receiverConversion === undefined) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_PROVIDER_HELPER_RECEIVER_MISSING",
          "A receiver-backed Mojo helper call has no sealed receiver contract.",
          node,
        );
        return undefined;
      }
      receiver = prepareMojoReceiver(
        selection.receiver,
        selection.sourceReceiverType,
        false,
        context,
        planValue,
      );
      convertedReceiver = receiver === undefined
        ? undefined
        : convertMojoValue(receiver.plan, selection.receiverConversion, context);
      if (receiver === undefined || convertedReceiver === undefined) return undefined;
    }
    const ordered = orderCallArguments(
      plannedArguments,
      context,
      convertedReceiver === undefined || selection.operation.receiverType === undefined
        ? undefined
        : Object.freeze({
            plan: convertedReceiver,
            type: selection.operation.receiverType,
            role: "call_receiver",
          }),
    );
    before = ordered.before;
    call = {
      kind: "call",
      callee: { kind: "path", path: [...target.modulePath, ...(target.ownerPath ?? []), target.name].join(".") },
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: target.receiver === undefined
        ? ordered.arguments
        : Object.freeze([
            Object.freeze({
              value: target.receiver === "var" || target.receiver === "deinit"
                ? Object.freeze({ kind: "consume" as const, expression: ordered.receiver! })
                : ordered.receiver!,
            }),
            ...ordered.arguments,
          ]),
    };
  } else {
    if (selection.receiver === undefined || selection.sourceReceiverType === undefined) return undefined;
    const preparedReceiver = prepareMojoReceiver(
      selection.receiver,
      selection.sourceReceiverType,
      selection.optionalChain,
      context,
      planValue,
    );
    const receiver = preparedReceiver === undefined || selection.receiverConversion === undefined
      ? preparedReceiver?.plan
      : convertMojoValue(preparedReceiver.plan, selection.receiverConversion, context);
    if (preparedReceiver === undefined || receiver === undefined || selection.operation.receiverType === undefined) {
      return undefined;
    }
    const ordered = orderCallArguments(plannedArguments, context, Object.freeze({
      plan: receiver,
      type: selection.operation.receiverType,
      role: "call_receiver",
      ...(target.receiver === "mut" ? { stabilize: true } : {}),
    }));
    before = ordered.before;
    call = {
      kind: "method-call",
      receiver: target.receiver === "var" || target.receiver === "deinit"
        ? { kind: "consume", expression: ordered.receiver! }
        : ordered.receiver!,
      name: target.name,
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: ordered.arguments,
    };
    const converted = convertMojoValue(withMojoValue(before, call), selection.resultConversion, context);
    if (converted === undefined) return undefined;
    return finishOptionalMojoOperation(node, preparedReceiver, converted, context);
  }
  return convertMojoValue(withMojoValue(before, call), selection.resultConversion, context);
}

function planCallableArgumentSlot(
  slot: MojoCallableArgumentSlot,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PlannedMojoCallArgument | undefined {
  if (slot.kind === "value") return planSelectedArgument(slot.argument, context, planValue);
  registerMojoTypeImports(slot.type, context);
  if (slot.kind === "optional-absent") {
    if (slot.type.kind !== "optional") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_CALLABLE_OPTIONAL_SLOT_TYPE_INVALID",
        "An omitted callable argument requires an exact Optional[T] ABI slot.",
        context.module.sourceFile,
      );
      return undefined;
    }
    return Object.freeze({
      plan: mojoValue(Object.freeze({
        kind: "construct",
        type: slot.type,
        arguments: Object.freeze([]),
      })),
      type: slot.type,
      spread: false,
    });
  }
  const items = slot.arguments.map((argument) => planSelectedArgument(argument, context, planValue));
  if (items.some((item) => item === undefined)) return undefined;
  const ordered = orderMojoValues((items as PlannedMojoCallArgument[]).map((item) => Object.freeze({
    plan: item.plan,
    type: item.type,
    role: "callable_rest_argument",
  })), context);
  if (slot.arguments.some((argument) => argument.spread)) {
    return planSpreadCallableRestSlot(slot, ordered.before, ordered.values, context);
  }
  const values: MojoExpression = Object.freeze({ kind: "list", elements: Object.freeze(ordered.values) });
  const collection = slot.type.kind === "list"
    ? values
    : slot.type.kind === "target-named" && slot.type.id === "tsonic.mojo.js.JsArray"
      ? Object.freeze({
          kind: "construct" as const,
          type: slot.type,
          arguments: Object.freeze([{ value: values }]),
        })
      : undefined;
  if (collection === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_CALLABLE_REST_SLOT_TYPE_INVALID",
      "A retained callable rest slot requires a native list or JavaScript array carrier.",
      context.module.sourceFile,
    );
    return undefined;
  }
  return Object.freeze({
    plan: withMojoValue(ordered.before, collection),
    type: slot.type,
    spread: false,
  });
}

function planSpreadCallableRestSlot(
  slot: Extract<MojoCallableArgumentSlot, { readonly kind: "rest" }>,
  orderedBefore: readonly MojoStatement[],
  values: readonly MojoExpression[],
  context: MojoPlanningContext,
): PlannedMojoCallArgument | undefined {
  const listType = Object.freeze({ kind: "list" as const, element: slot.elementType });
  registerMojoTypeImports(listType, context);
  const listName = allocateMojoSyntheticName(context, "callable_rest_values");
  const before: MojoStatement[] = [
    ...orderedBefore,
    Object.freeze({
      kind: "variable",
      name: listName,
      type: listType,
      initializer: Object.freeze({
        kind: "construct",
        type: listType,
        arguments: Object.freeze([]),
      }),
    }),
  ];
  for (const [index, argument] of slot.arguments.entries()) {
    const value = values[index]!;
    if (!argument.spread) {
      before.push(appendRestValue(listName, value));
      continue;
    }
    const iterable = spreadRestIterable(value, argument.parameterType);
    if (iterable === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_CALLABLE_REST_SPREAD_CARRIER_INVALID",
        "A callable rest spread requires one exact native List or JavaScript array carrier.",
        argument.expression,
      );
      return undefined;
    }
    const itemName = allocateMojoSyntheticName(context, "callable_rest_item");
    before.push(Object.freeze({
      kind: "for",
      binding: itemName,
      iterable,
      statements: Object.freeze([appendRestValue(
        listName,
        Object.freeze({
          kind: "method-call",
          receiver: Object.freeze({ kind: "path", path: itemName }),
          name: "copy",
          arguments: Object.freeze([]),
        }),
      )]),
    }));
  }
  const nativeList: MojoExpression = Object.freeze({
    kind: "consume",
    expression: Object.freeze({ kind: "path", path: listName }),
  });
  const result = slot.type.kind === "list"
    ? nativeList
    : slot.type.kind === "target-named" && slot.type.id === "tsonic.mojo.js.JsArray"
      ? Object.freeze({
          kind: "construct" as const,
          type: slot.type,
          arguments: Object.freeze([{ value: nativeList }]),
        })
      : undefined;
  if (result === undefined) return undefined;
  return Object.freeze({
    plan: withMojoValue(Object.freeze(before), result),
    type: slot.type,
    spread: false,
  });
}

function spreadRestIterable(
  value: MojoExpression,
  type: import("../../../target-model/types/model.js").MojoTargetTypeRef,
): MojoExpression | undefined {
  if (type.kind === "list") return value;
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray"
    ? Object.freeze({
        kind: "method-call",
        receiver: value,
        name: "iter_values",
        arguments: Object.freeze([]),
      })
    : undefined;
}

function appendRestValue(listName: string, value: MojoExpression): MojoStatement {
  return Object.freeze({
    kind: "expression",
    expression: Object.freeze({
      kind: "method-call",
      receiver: Object.freeze({ kind: "path", path: listName }),
      name: "append",
      arguments: Object.freeze([{ value }]),
    }),
  });
}
