import type { Node } from "@tsonic/tsts";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoTargetGenericArgumentsInContext,
  mojoTargetTypeInContext,
  mojoModuleMemberExpression,
  mojoModulePathExpression,
  mojoSelfExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  convertMojoValue,
  finishOptionalMojoOperation,
  orderCallArguments,
  orderMojoValues,
  planSelectedArguments,
  prepareMojoReceiver,
  unsupportedOptionalCall,
} from "./support.js";
import type {
  MojoValuePlanner,
  PlannedMojoCallArgument,
} from "./support.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { applyArgumentDisposition, planCallableArgumentSlot } from "./call-arguments.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";

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
  if (selection.kind === "source-intrinsic") {
    if (selection.operation === "comptime-type") {
      return selection.value === undefined
        ? undefined
        : mojoValue(Object.freeze({ kind: "generic-argument-value", value: selection.value }));
    }
    if (selection.operand === undefined) return undefined;
    const operand = planValue(selection.operand, context, selection.resultType);
    if (operand === undefined) return undefined;
    switch (selection.operation) {
      case "comptime-value":
      case "comptime-condition":
        return withMojoValue(operand.before, Object.freeze({
          kind: "forced-comptime",
          expression: operand.value,
        }));
      case "comptime-iteration":
      case "write-only-reference":
      case "read-write-reference":
      case "read-only-reference":
      case "shared-borrow":
      case "mutable-borrow":
        return operand;
      case "js-string":
        registerMojoTypeImports(selection.resultType, context);
        return withMojoValue(operand.before, Object.freeze({
          kind: "construct",
          type: selection.resultType,
          arguments: Object.freeze([Object.freeze({ value: operand.value })]),
        }));
      case "copy":
        return withMojoValue(operand.before, Object.freeze({
          kind: "copy",
          expression: operand.value,
        }));
      case "materialize":
        return withMojoValue(operand.before, Object.freeze({
          kind: "materialize",
          expression: operand.value,
        }));
      case "move":
        return withMojoValue(
          operand.before,
          consumeMojoValue(
            operand.value,
            selection.resultType,
            context.program.lifecycle,
          ),
        );
    }
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
    if (selection.operation === "bind") {
      const identity = planValue(selection.identityExpression, context, selection.identityType);
      return identity === undefined
        ? undefined
        : withMojoValue(identity.before, Object.freeze({
            kind: "call",
            callee: mojoModuleMemberExpression(
              context,
              ["tsonic_runtime"],
              "raw_pointer_from_arc",
            ),
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
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_runtime"],
          "equal_raw_pointer",
        ),
        arguments: Object.freeze(ordered.values.map((value) => Object.freeze({ value }))),
      }));
    }
    const pointer = planValue(selection.pointerExpression, context, selection.pointerType);
    return pointer === undefined
      ? undefined
      : withMojoValue(pointer.before, Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            ["tsonic_runtime"],
            "hash_raw_pointer",
          ),
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
    const genericArguments = mojoTargetGenericArgumentsInContext(
      selection.genericArguments,
      context,
    );
    const plannedArguments = planSelectedArguments(selection.arguments, context, planValue);
    if (plannedArguments === undefined) return undefined;
    let call: MojoExpression;
    let before: readonly MojoStatement[];
    switch (selection.target.kind) {
      case "function": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        const requiresSpecialization = context.program.sourceCallableSpecializations
          .requiresSpecialization(selection.target.declaration);
        const specialization = requiresSpecialization
          ? context.program.sourceCallableSpecializations.variantForCall(
              selection.target.declaration,
              genericArguments,
            )
          : undefined;
        if (requiresSpecialization && specialization === undefined) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_SOURCE_CALLABLE_SPECIALIZATION_NOT_SEALED",
            "A selected project function call has no exact finite Mojo specialization.",
            node,
          );
          return undefined;
        }
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            selection.target.modulePath,
            specialization?.targetName ?? selection.target.name,
          ),
          ...(genericArguments.length === 0 || specialization !== undefined
            ? {}
            : { genericArguments }),
          arguments: ordered.arguments,
        };
        break;
      }
      case "method": {
        const receiverType = mojoTargetTypeInContext(selection.target.receiverType, context);
        const exactDispatch = selection.target.dispatch === "exact";
        const exactConversion = exactDispatch && context.selfType !== undefined
          ? context.program.projectDispatch.conversionFor(
              context.selfType,
              receiverType,
            )
          : undefined;
        const exactReceiver = exactDispatch && context.selfType !== undefined
          ? exactConversion === undefined &&
              mojoTargetTypeEquals(context.selfType, receiverType)
            ? mojoValue(mojoSelfExpression(context))
            : exactConversion === undefined
              ? undefined
              : mojoValue(Object.freeze({
                  kind: "method-call",
                  receiver: mojoSelfExpression(context),
                  name: exactConversion.name,
                  arguments: Object.freeze([]),
                }))
          : undefined;
        const receiver = exactDispatch
          ? exactReceiver === undefined
            ? undefined
            : Object.freeze({ kind: "required", plan: exactReceiver })
          : prepareMojoReceiver(
              selection.target.receiver,
              receiverType,
              selection.optionalChain,
              context,
              planValue,
            );
        if (exactDispatch && receiver === undefined) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_PROJECT_EXACT_DISPATCH_RECEIVER_NOT_SEALED",
            "An exact super-method call has no sealed conversion from the current project view to its selected owner view.",
            node,
          );
          return undefined;
        }
        if (receiver === undefined) return undefined;
        const ordered = orderCallArguments(plannedArguments, context, Object.freeze({
          plan: receiver.plan,
          type: receiverType,
          role: "call_receiver",
        }));
        before = ordered.before;
        const dispatchView = context.program.projectDispatch.viewForType(receiverType);
        const dispatch = dispatchView === undefined
          ? undefined
          : context.program.projectDispatch.callableFor(
              receiverType,
              selection.target.declaration,
              genericArguments,
            );
        const exactName = exactDispatch
          ? context.program.projectDispatch.implementationName(
              selection.target.implementationDeclaration,
              genericArguments,
            )
          : undefined;
        const requiresSpecialization = context.program.sourceCallableSpecializations
          .requiresSpecialization(selection.target.implementationDeclaration);
        const specialization = requiresSpecialization
          ? context.program.sourceCallableSpecializations.variantForCall(
              selection.target.implementationDeclaration,
              genericArguments,
            )
          : undefined;
        if (dispatchView === undefined && requiresSpecialization && specialization === undefined) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_SOURCE_METHOD_SPECIALIZATION_NOT_SEALED",
            "A selected project method call has no exact finite Mojo specialization.",
            node,
          );
          return undefined;
        }
        if (dispatchView !== undefined && (!exactDispatch && dispatch === undefined ||
          exactDispatch && exactName === undefined)) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_PROJECT_METHOD_DISPATCH_NOT_SEALED",
            "A polymorphic project method call has no exact sealed Mojo dispatch slot.",
            node,
          );
          return undefined;
        }
        call = {
          kind: "method-call",
          receiver: ordered.receiver!,
          name: exactName ?? dispatch?.name ?? specialization?.targetName ?? selection.target.name,
          ...(dispatch !== undefined || exactName !== undefined || specialization !== undefined ||
              genericArguments.length === 0
            ? {}
            : { genericArguments }),
          arguments: ordered.arguments,
        };
        const converted = convertMojoValue(withMojoValue(before, call), selection.resultConversion, context);
        if (converted === undefined) return undefined;
        return finishOptionalMojoOperation(node, receiver, converted, context);
      }
      case "static-method": {
        if (selection.optionalChain) return unsupportedOptionalCall(node, context);
        registerMojoTypeImports(selection.target.owner, context);
        const requiresSpecialization = context.program.sourceCallableSpecializations
          .requiresSpecialization(selection.target.implementationDeclaration);
        const specialization = requiresSpecialization
          ? context.program.sourceCallableSpecializations.variantForCall(
              selection.target.implementationDeclaration,
              genericArguments,
            )
          : undefined;
        if (requiresSpecialization && specialization === undefined) {
          appendMojoPlanningDiagnostic(
            context,
            "MOJO_SOURCE_STATIC_METHOD_SPECIALIZATION_NOT_SEALED",
            "A selected project static-method call has no exact finite Mojo specialization.",
            node,
          );
          return undefined;
        }
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = {
          kind: "method-call",
          receiver: { kind: "type-value", type: selection.target.owner },
          name: specialization?.targetName ?? selection.target.name,
          ...(genericArguments.length === 0 || specialization !== undefined
            ? {}
            : { genericArguments }),
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
    const actualCalleeType = context.program.queries.expressionType(selection.callee);
    const optionalCallee = selection.optionalChain && actualCalleeType?.kind === "optional";
    const callee = prepareMojoReceiver(
      selection.callee,
      selection.callableType,
      optionalCallee,
      context,
      planValue,
    );
    if (callee === undefined) return undefined;
    const callableDisposition = context.program.representations.callable(selection.callee);
    if (callableDisposition !== undefined && callableDisposition.kind !== "erased") {
      const allArguments = planSelectedArguments(selection.arguments, context, planValue);
      if (allArguments === undefined) return undefined;
      const plannedByArgument = new Map(selection.arguments.map((argument, index) =>
        [argument, allArguments[index]!] as const));
      const arguments_ = selection.argumentSlots.map((slot) =>
        planCallableArgumentSlot(slot, context, planValue, plannedByArgument));
      if (arguments_.some((argument) => argument === undefined)) {
        return undefined;
      }
      const ordered = orderCallArguments(
        arguments_ as PlannedMojoCallArgument[],
        context,
        Object.freeze({ plan: callee.plan, type: selection.callableType, role: "callable_value" }),
      );
      const call: MojoExpression = Object.freeze({
        kind: "call",
        callee: ordered.receiver!,
        arguments: ordered.arguments,
      });
      const converted = convertMojoValue(
        withMojoValue(ordered.before, call),
        selection.resultConversion,
        context,
      );
      return converted === undefined
        ? undefined
        : finishOptionalMojoOperation(node, callee, converted, context);
    }
    const allArguments = planSelectedArguments(selection.arguments, context, planValue);
    if (allArguments === undefined) return undefined;
    const plannedByArgument = new Map(selection.arguments.map((argument, index) =>
      [argument, allArguments[index]!] as const));
    const arguments_ = selection.argumentSlots.map((slot) =>
      planCallableArgumentSlot(slot, context, planValue, plannedByArgument));
    if (arguments_.some((argument) => argument === undefined)) return undefined;
    const ordered = orderCallArguments(
      arguments_ as PlannedMojoCallArgument[],
      context,
      Object.freeze({ plan: callee.plan, type: selection.callableType, role: "callable_value" }),
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
    const converted = convertMojoValue(
      withMojoValue(ordered.before, call),
      selection.resultConversion,
      context,
    );
    return converted === undefined
      ? undefined
      : finishOptionalMojoOperation(node, callee, converted, context);
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
  const plannedArguments = planSelectedArguments(selection.arguments, context, planValue);
  if (plannedArguments === undefined) return undefined;
  let call: MojoExpression;
  let before: readonly MojoStatement[];
  if (target.kind === "function-call") {
    if (selection.optionalChain) return unsupportedOptionalCall(node, context);
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
      callee: mojoModulePathExpression(
        context,
        target.modulePath,
        Object.freeze([...(target.ownerPath ?? []), target.name]),
      ),
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: target.receiver === undefined
        ? ordered.arguments
        : Object.freeze([
            Object.freeze({
              value: applyArgumentDisposition(
                ordered.receiver!,
                selection.receiverDisposition,
                selection.operation.receiverType!,
                context,
              ),
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
      receiver: applyArgumentDisposition(
        ordered.receiver!,
        selection.receiverDisposition,
        selection.operation.receiverType,
        context,
      ),
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
