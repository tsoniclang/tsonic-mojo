import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleBindingRead, mojoModuleBindingWrite } from "../bindings/module-bindings.js";
import { mojoTypeName, registerMojoTypeImports } from "../types/render.js";
import {
  convertMojoValue,
  finishOptionalMojoOperation,
  orderMojoValues,
  planProviderConstant,
  prepareMojoReceiver,
} from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planDictionaryKey } from "./conditional-values.js";

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
  if (selection.kind === "provider-static") {
    if (mode !== "read" || selection.readOperation?.target.kind !== "function-read" ||
      selection.readResultConversion === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_STATIC_PROPERTY_LOCATION_REQUIRED",
        "A static provider write must be planned as its sealed target function operation.",
        node,
      );
      return undefined;
    }
    const value = planProviderConstant(
      selection.readOperation,
      selection.readResultConversion,
      context,
    );
    return value === undefined ? undefined : mojoValue(value);
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
  if (selection.kind === "project-union-field") {
    if (mode !== "read") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_UNION_PROPERTY_WRITE_UNSUPPORTED",
        "A sealed project-union property projection is read-only.",
        node,
      );
      return undefined;
    }
    const receiver = prepareMojoReceiver(
      selection.receiver,
      selection.receiverType,
      false,
      context,
      planValue,
    );
    if (receiver === undefined) return undefined;
    registerMojoTypeImports(selection.receiverType, context);
    registerMojoTypeImports(selection.resultType, context);
    for (const field of selection.fields) registerMojoTypeImports(field.receiverType, context);
    const ordered = orderMojoValues([
      Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "union_property_receiver" }),
    ], context, true);
    const receiverValue = ordered.values[0]!;
    const readField = (field: (typeof selection.fields)[number]): MojoExpression => Object.freeze({
      kind: "member",
      receiver: Object.freeze({
        kind: "postfix-deref",
        expression: Object.freeze({
          kind: "member",
          receiver: Object.freeze({
            kind: "type-element",
            receiver: receiverValue,
            type: field.receiverType,
          }),
          name: "_state",
        }),
      }),
      name: field.fieldName,
    });
    let expression = readField(selection.fields[selection.fields.length - 1]!);
    for (let index = selection.fields.length - 2; index >= 0; index -= 1) {
      const field = selection.fields[index]!;
      expression = Object.freeze({
        kind: "conditional",
        condition: Object.freeze({
          kind: "method-call",
          receiver: receiverValue,
          name: "isa",
          genericArguments: Object.freeze([Object.freeze({ kind: "type", type: field.receiverType })]),
          arguments: Object.freeze([]),
        }),
        whenTrue: readField(field),
        whenFalse: expression,
      });
    }
    return withMojoValue(ordered.before, expression);
  }
  const sourceReceiverType = selection.kind === "project-field" || selection.kind === "project-index-property"
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
  if (selection.kind === "project-index-property") {
    const key = planDictionaryKey(selection.key, selection.keyType, context);
    if (key === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_INDEX_PROPERTY_KEY_UNSUPPORTED",
        "A selected project index property has no exact Mojo dictionary-key carrier.",
        node,
      );
      return undefined;
    }
    const ordered = orderMojoValues([
      Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "index_property_receiver" }),
    ], context, stabilizeReceiver);
    const operation = withMojoValue(ordered.before, Object.freeze({
      kind: "element",
      receiver: Object.freeze({
        kind: "member",
        receiver: Object.freeze({
          kind: "postfix-deref",
          expression: Object.freeze({ kind: "member", receiver: ordered.values[0]!, name: "_state" }),
        }),
        name: selection.storageName,
      }),
      index: key,
    }));
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
