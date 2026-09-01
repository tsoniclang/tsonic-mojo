import type { Node } from "@tsonic/tsts";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoQualifiedModuleMember,
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  applyMojoConversion,
  convertMojoValue,
  finishOptionalMojoOperation,
  orderCallArguments,
  orderMojoValues,
  planProviderConstant,
  planSelectedArgument,
  prepareMojoReceiver,
  requiredMojoTypeName,
  unsupportedOptionalCall,
} from "./support.js";
import type {
  MojoValuePlanner,
  PlannedMojoCallArgument,
} from "./support.js";
import { mojoModuleBindingRead, mojoModuleBindingWrite } from "../bindings/module-bindings.js";
import { mojoTypeName, registerMojoTypeImports } from "../types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoElement(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  mode: "read" | "write",
  stabilizeComponents = false,
): MojoValuePlan | undefined {
  const selection = context.program.queries.elementSelection(node);
  if (selection === undefined || (mode === "read" ? selection.readType : selection.writeType) === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_ELEMENT_PLAN_MISSING",
      `Element access has no sealed ${mode} selection.`,
      node,
    );
    return undefined;
  }
  const sourceReceiverType = selection.kind === "native"
    ? selection.receiverType
    : selection.sourceReceiverType;
  const preparedReceiver = prepareMojoReceiver(
    selection.receiver,
    sourceReceiverType,
    selection.optionalChain,
    context,
    planValue,
  );
  const receiver = preparedReceiver === undefined
    ? undefined
    : selection.kind === "provider"
      ? convertMojoValue(preparedReceiver.plan, selection.receiverConversion, context)
      : preparedReceiver.plan;
  const rawIndex = planValue(selection.index, context);
  const index = rawIndex === undefined
    ? undefined
    : convertMojoValue(rawIndex, selection.indexConversion, context);
  if (preparedReceiver === undefined || receiver === undefined || index === undefined) return undefined;
  const operation = selection.kind === "provider"
    ? mode === "read" ? selection.readOperation : selection.writeOperation
    : undefined;
  if (selection.kind === "provider") {
    const expectedKind = mode === "read" ? "index-read" : "index-write";
    if (operation?.target.kind !== expectedKind) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_ELEMENT_FORM_INVALID",
        `Provider element ${mode} has no sealed '${expectedKind}' form.`,
        node,
      );
      return undefined;
    }
  }
  const receiverType = selection.kind === "native" ? selection.receiverType : operation?.receiverType;
  const indexType = selection.kind === "native" ? selection.indexType : operation?.parameterTypes[0];
  if (receiverType === undefined || indexType === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver, type: receiverType, role: "element_receiver" }),
    Object.freeze({ plan: index, type: indexType, role: "element_index" }),
  ], context, stabilizeComponents);
  const access: MojoExpression = selection.kind === "provider" &&
      operation?.target.kind === "index-read" && operation.target.access.kind === "method"
    ? {
        kind: "method-call",
        receiver: ordered.values[0]!,
        name: operation.target.access.name,
        arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
      }
    : {
        kind: "element",
        receiver: ordered.values[0]!,
        index: ordered.values[1]!,
      };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(ordered.before, access)
    : convertMojoValue(
        withMojoValue(ordered.before, access),
        selection.readResultConversion,
        context,
      );
  return operationPlan === undefined
    ? undefined
    : finishOptionalMojoOperation(node, preparedReceiver, operationPlan, context);
}

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
        const converted = applyMojoConversion(call, selection.resultConversion, context);
        if (converted === undefined) return undefined;
        return finishOptionalMojoOperation(node, receiver, withMojoValue(before, converted), context);
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
    const converted = applyMojoConversion(call, selection.resultConversion, context);
    return converted === undefined ? undefined : withMojoValue(before, converted);
  }
  if (selection.kind === "callable") {
    if (selection.optionalChain) return unsupportedOptionalCall(node, context);
    const callee = planValue(selection.callee, context);
    const arguments_ = selection.arguments.map((argument) => planSelectedArgument(argument, context, planValue));
    if (callee === undefined || arguments_.some((argument) => argument === undefined)) return undefined;
    const ordered = orderCallArguments(
      arguments_ as PlannedMojoCallArgument[],
      context,
      Object.freeze({ plan: callee, type: selection.callableType, role: "callable_value" }),
    );
    const call: MojoExpression = Object.freeze({
      kind: "call",
      callee: ordered.receiver!,
      arguments: ordered.arguments,
    });
    const converted = applyMojoConversion(call, selection.resultConversion, context);
    return converted === undefined ? undefined : withMojoValue(ordered.before, converted);
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
    const ordered = orderCallArguments(plannedArguments, context);
    before = ordered.before;
    call = {
      kind: "call",
      callee: { kind: "path", path: [...target.modulePath, ...(target.ownerPath ?? []), target.name].join(".") },
      ...(selection.operation.genericArguments.length === 0
        ? {}
        : { genericArguments: selection.operation.genericArguments }),
      arguments: ordered.arguments,
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
    const converted = applyMojoConversion(call, selection.resultConversion, context);
    if (converted === undefined) return undefined;
    return finishOptionalMojoOperation(node, preparedReceiver, withMojoValue(before, converted), context);
  }
  const converted = applyMojoConversion(call, selection.resultConversion, context);
  return converted === undefined ? undefined : withMojoValue(before, converted);
}

export function planMojoProperty(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  mode: "read" | "write",
  stabilizeReceiver = false,
): MojoValuePlan | undefined {
  const selection = context.program.queries.propertySelection(node);
  if (selection === undefined) {
    appendMojoPlanningDiagnostic(context, "MOJO_PROPERTY_PLAN_MISSING", "Property access has no sealed target selection.", node);
    return undefined;
  }
  if (selection.kind === "provider-constant") {
    if (mode !== "read") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_CONSTANT_WRITE_UNSUPPORTED",
        "A provider module constant cannot be planned as a writable location.",
        node,
      );
      return undefined;
    }
    const constant = planProviderConstant(selection.operation, selection.readResultConversion, context);
    return constant === undefined ? undefined : mojoValue(constant);
  }
  if (selection.kind === "project-enum-member") {
    if (mode !== "read") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_ENUM_MEMBER_WRITE_UNSUPPORTED",
        "A project enum member is an immutable compile-time value.",
        node,
      );
      return undefined;
    }
    registerMojoTypeImports(selection.owner, context);
    const owner = mojoTypeName(selection.owner, context.module.modulePath);
    return owner === undefined
      ? undefined
      : mojoValue(Object.freeze({ kind: "path", path: `${owner}.${selection.name}` }));
  }
  if (selection.kind === "project-static-field") {
    if (selection.optionalChain) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_STATIC_FIELD_OPTIONAL_CHAIN_UNSUPPORTED",
        "A project static field optional chain requires an exact nullable class-value carrier.",
        node,
      );
      return undefined;
    }
    const field = mode === "read"
      ? mojoModuleBindingRead(selection.binding, context)
      : mojoModuleBindingWrite(selection.binding, context);
    return field === undefined ? undefined : mojoValue(field);
  }
  const sourceReceiverType = selection.kind === "project-field"
    ? selection.receiverType
    : selection.sourceReceiverType;
  const receiver = prepareMojoReceiver(
    selection.receiver,
    sourceReceiverType,
    selection.optionalChain,
    context,
    planValue,
  );
  if (receiver === undefined) return undefined;
  if (selection.kind === "project-field") {
    const ordered = orderMojoValues([
      Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "property_receiver" }),
    ], context, stabilizeReceiver);
    const operation = withMojoValue(ordered.before, {
      kind: "member",
      receiver: {
        kind: "postfix-deref",
        expression: { kind: "member", receiver: ordered.values[0]!, name: "_state" },
      },
      name: selection.fieldName,
    });
    return finishOptionalMojoOperation(node, receiver, operation, context);
  }
  const operation = mode === "read" ? selection.readOperation : selection.writeOperation;
  if (operation === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_PROPERTY_ACCESS_MODE_MISSING",
      `Provider property has no sealed ${mode} operation.`,
      node,
    );
    return undefined;
  }
  const target = operation.target;
  if ((mode === "read" && target.kind !== "property-read") ||
    (mode === "write" && target.kind !== "property-write")) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_PROPERTY_FORM_INVALID",
      `Provider property ${mode} selected target form '${target.kind}'.`,
      node,
    );
    return undefined;
  }
  const convertedReceiver = selection.receiverConversion === undefined
    ? receiver.plan
    : convertMojoValue(receiver.plan, selection.receiverConversion, context);
  if (convertedReceiver === undefined || operation.receiverType === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: convertedReceiver, type: operation.receiverType, role: "property_receiver" }),
  ], context, stabilizeReceiver);
  if (target.kind !== "property-read" && target.kind !== "property-write") return undefined;
  const member: MojoExpression = target.access.kind === "member"
    ? { kind: "member", receiver: ordered.values[0]!, name: target.access.name }
    : {
        kind: "method-call",
        receiver: ordered.values[0]!,
        name: target.access.name,
        arguments: Object.freeze([]),
      };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(ordered.before, member)
    : convertMojoValue(withMojoValue(ordered.before, member), selection.readResultConversion, context);
  return operationPlan === undefined
    ? undefined
    : finishOptionalMojoOperation(node, receiver, operationPlan, context);
}
