import type { Node } from "@tsonic/tsts";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleBindingRead, mojoModuleBindingWrite } from "../bindings/module-bindings.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import { registerMojoTypeImports } from "../types/imports.js";
import {
  convertMojoValue,
  finishOptionalMojoOperation,
  orderMojoValues,
  planProviderConstant,
  prepareMojoReceiver,
} from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import type { MojoPreparedMutation } from "./mutation-plan.js";
import { planDictionaryKey } from "./conditional-values.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";
import { mojoConvertedValueType } from "../../../analysis/operations/call-results.js";

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
    return planProviderConstant(selection.operation, selection.readResultConversion, context);
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
    return planProviderConstant(
      selection.readOperation,
      selection.readResultConversion,
      context,
    );
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
    return mojoValue(Object.freeze({
      kind: "member",
      receiver: Object.freeze({ kind: "type-value", type: selection.owner }),
      name: selection.name,
    }));
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
  const sourceReceiverType = selection.kind === "project-method" ||
    selection.kind === "project-field" ||
    selection.kind === "project-index-property" || selection.kind === "project-accessor" ||
    selection.kind === "structural-field"
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
  if (selection.kind === "project-method") {
    if (mode !== "read") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_METHOD_WRITE_REQUIRES_VALUE",
        "A project method replacement must be planned with its exact callable value.",
        node,
      );
      return undefined;
    }
    const variant = context.program.projectDispatch.callableFor(
      selection.receiverType,
      selection.declaration,
      Object.freeze([]),
    );
    if (variant?.property?.read === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_METHOD_READ_DISPATCH_NOT_SEALED",
        "A project method value read has no exact sealed bound-callable dispatch slot.",
        node,
      );
      return undefined;
    }
    const ordered = orderMojoValues([
      Object.freeze({
        plan: receiver.plan,
        type: selection.receiverType,
        role: "method_value_receiver",
      }),
    ], context, stabilizeReceiver);
    const operation = withMojoValue(ordered.before, Object.freeze({
      kind: "method-call",
      receiver: ordered.values[0]!,
      name: variant.property.read.name,
      arguments: Object.freeze([]),
    }));
    return finishOptionalMojoOperation(node, receiver, operation, context);
  }
  if (selection.kind === "project-field") {
    const directState = context.initializingState !== undefined &&
      context.program.source.ast.kindName(selection.receiver) === "KindThisKeyword" &&
      mojoTargetTypeEquals(context.initializingState.referenceType, selection.receiverType);
    const dispatchView = context.program.projectDispatch.viewForType(selection.receiverType);
    const dispatch = dispatchView === undefined
      ? undefined
      : context.program.projectDispatch.fieldFor(selection.receiverType, selection.declaration);
    if (dispatchView !== undefined && dispatch?.read === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_FIELD_READ_DISPATCH_NOT_SEALED",
        "A polymorphic project field read has no exact sealed Mojo dispatch slot.",
        node,
      );
      return undefined;
    }
    const ordered = orderMojoValues([
      Object.freeze({
        plan: receiver.plan,
        type: directState ? context.initializingState!.stateType : selection.receiverType,
        role: "property_receiver",
      }),
    ], context, stabilizeReceiver && !directState);
    const sealedStatePath = directState
      ? context.program.projectDispatch.statePath(
          context.initializingState!.definition,
          selection.declaration,
        )
      : undefined;
    if (directState && dispatchView !== undefined && sealedStatePath === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_CONSTRUCTOR_FIELD_PATH_NOT_SEALED",
        "A polymorphic constructor field access has no exact sealed state path.",
        node,
      );
      return undefined;
    }
    const directPath = directState ? sealedStatePath ?? [selection.fieldName] : undefined;
    const directReceiver = directPath === undefined
      ? undefined
      : directPath.slice(0, -1).reduce<MojoExpression>(
          (value, name) => Object.freeze({ kind: "member", receiver: value, name }),
          ordered.values[0]!,
        );
    const operation = withMojoValue(ordered.before, dispatch === undefined || directState
      ? {
          kind: "member",
          receiver: directState
            ? directReceiver!
            : {
                kind: "postfix-deref",
                expression: { kind: "member", receiver: ordered.values[0]!, name: "_state" },
              },
          name: directPath?.[directPath.length - 1] ?? selection.fieldName,
        }
      : Object.freeze({
          kind: "method-call" as const,
          receiver: ordered.values[0]!,
          name: dispatch.read!.name,
          arguments: Object.freeze([]),
        }));
    return finishOptionalMojoOperation(node, receiver, operation, context);
  }
  if (selection.kind === "project-accessor") {
    if (mode !== "read" || selection.readName === undefined || selection.readType === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_ACCESSOR_WRITE_REQUIRES_VALUE",
        "A project accessor write must be planned with its exact assigned value.",
        node,
      );
      return undefined;
    }
    const dispatchView = context.program.projectDispatch.viewForType(selection.receiverType);
    const dispatch = dispatchView === undefined
      ? undefined
      : selectedDispatchField(selection.receiverType, selection.declarations, context);
    if (dispatchView !== undefined && dispatch?.read === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_ACCESSOR_READ_DISPATCH_NOT_SEALED",
        "A polymorphic project accessor read has no exact sealed Mojo dispatch slot.",
        node,
      );
      return undefined;
    }
    const ordered = orderMojoValues([
      Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "accessor_receiver" }),
    ], context, stabilizeReceiver);
    const operation = withMojoValue(ordered.before, Object.freeze({
      kind: "method-call",
      receiver: ordered.values[0]!,
      name: dispatch?.read?.name ?? selection.readName,
      arguments: Object.freeze([]),
    }));
    return finishOptionalMojoOperation(node, receiver, operation, context);
  }
  if (selection.kind === "structural-field") {
    const ordered = orderMojoValues([
      Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "property_receiver" }),
    ], context, stabilizeReceiver);
    const operation = withMojoValue(ordered.before, Object.freeze({
      kind: "element",
      receiver: Object.freeze({
        kind: "postfix-deref",
        expression: Object.freeze({
          kind: "member",
          receiver: ordered.values[0]!,
          name: "_state",
        }),
      }),
      index: Object.freeze({ kind: "number-literal", text: String(selection.storageIndex) }),
    }));
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
    const dispatchView = context.program.projectDispatch.viewForType(selection.receiverType);
    const dispatch = dispatchView === undefined
      ? undefined
      : context.program.projectDispatch.indexFor(selection.receiverType, selection.declaration);
    if (dispatchView !== undefined && dispatch === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_INDEX_PROPERTY_DISPATCH_NOT_SEALED",
        "A polymorphic project index property has no exact sealed dispatch slot.",
        node,
      );
      return undefined;
    }
    const operation = withMojoValue(ordered.before, dispatch === undefined
      ? Object.freeze({
          kind: "element" as const,
          receiver: Object.freeze({
            kind: "member" as const,
            receiver: Object.freeze({
              kind: "postfix-deref" as const,
              expression: Object.freeze({ kind: "member" as const, receiver: ordered.values[0]!, name: "_state" }),
            }),
            name: selection.storageName,
          }),
          index: key,
        })
      : Object.freeze({
          kind: "method-call" as const,
          receiver: ordered.values[0]!,
          name: dispatch.read.name,
          arguments: Object.freeze([Object.freeze({ value: key })]),
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
  if (mode === "write" && target.kind === "property-write" && target.access.kind === "method") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_PROPERTY_METHOD_WRITE_REQUIRES_VALUE",
      "A provider method-backed property write must be planned with its exact assigned value.",
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
    : target.access.kind === "method"
      ? {
          kind: "method-call",
          receiver: ordered.values[0]!,
          name: target.access.name,
          arguments: Object.freeze([]),
        }
      : {
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            target.access.modulePath,
            target.access.name,
          ),
          arguments: Object.freeze([Object.freeze({ value: ordered.values[0]! })]),
        };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(ordered.before, member)
    : convertMojoValue(withMojoValue(ordered.before, member), selection.readResultConversion, context);
  return operationPlan === undefined
    ? undefined
    : finishOptionalMojoOperation(node, receiver, operationPlan, context);
}

export function projectPropertyUsesMethodWrite(
  selection: import("../../../analysis/program/model.js").MojoPropertySelection | undefined,
  context: MojoPlanningContext,
): boolean {
  if (context.initializingState !== undefined &&
    selection?.kind === "project-field" &&
    context.program.source.ast.kindName(selection.receiver) === "KindThisKeyword" &&
    mojoTargetTypeEquals(context.initializingState.referenceType, selection.receiverType)) return false;
  if (selection?.kind === "project-accessor") return true;
  if (selection?.kind === "project-method") return true;
  if (selection?.kind === "project-index-property") {
    return context.program.projectDispatch.viewForType(selection.receiverType) !== undefined;
  }
  return selection?.kind === "project-field" &&
    context.program.projectDispatch.viewForType(selection.receiverType) !== undefined;
}

export function planMojoProjectPropertyWrite(
  node: Node,
  value: MojoValuePlan,
  operator: string,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoPreparedMutation | undefined {
  const selection = context.program.queries.propertySelection(node);
  if (selection?.kind !== "project-method" && selection?.kind !== "project-accessor" &&
    selection?.kind !== "project-field" && selection?.kind !== "project-index-property") {
    return undefined;
  }
  const variant = selection.kind === "project-method"
    ? context.program.projectDispatch.callableFor(
        selection.receiverType,
        selection.declaration,
        Object.freeze([]),
      )
    : undefined;
  const declarations = selection.kind === "project-field"
    ? [selection.declaration]
    : selection.kind === "project-accessor"
      ? selection.declarations
      : [];
  const dispatch = selection.kind === "project-method" || selection.kind === "project-index-property"
    ? undefined
    : selectedDispatchField(selection.receiverType, declarations, context);
  const indexDispatch = selection.kind === "project-index-property"
    ? context.program.projectDispatch.indexFor(selection.receiverType, selection.declaration)
    : undefined;
  const writeName = selection.kind === "project-method"
    ? variant?.property?.write?.name
    : selection.kind === "project-index-property"
      ? indexDispatch?.write?.name
    : dispatch?.write?.name ??
      (selection.kind === "project-accessor" ? selection.writeName : undefined);
  const writeType = selection.kind === "project-method"
    ? selection.callableType
    : selection.kind === "project-index-property"
      ? indexDispatch?.valueType
    : dispatch?.write?.valueType ??
      (selection.kind === "project-accessor" ? selection.writeType : selection.fieldType);
  const writeDisposition = selection.kind === "project-method"
    ? undefined
    : selection.kind === "project-index-property"
      ? undefined
    : dispatch?.write?.disposition ??
      (selection.kind === "project-accessor" ? selection.writeDisposition : undefined);
  const readName = selection.kind === "project-method"
    ? variant?.property?.read?.name
    : selection.kind === "project-index-property"
      ? indexDispatch?.read.name
    : dispatch?.read?.name ??
      (selection.kind === "project-accessor" ? selection.readName : undefined);
  const readType = selection.kind === "project-method"
    ? selection.callableType
    : selection.kind === "project-index-property"
      ? indexDispatch?.valueType
    : dispatch?.read?.valueType ??
      (selection.kind === "project-accessor" ? selection.readType : selection.fieldType);
  if (writeName === undefined || writeType === undefined) return undefined;
  if (selection.optionalChain) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_OPTIONAL_ACCESSOR_WRITE_UNSUPPORTED",
      "An optional project accessor assignment has no exact JavaScript write semantics.",
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
  const location = orderMojoValues([
    Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "accessor_write_receiver" }),
  ], context, true);
  const key = selection.kind === "project-index-property"
    ? planDictionaryKey(selection.key, selection.keyType, context)
    : undefined;
  if (selection.kind === "project-index-property" && key === undefined) return undefined;
  let before: readonly MojoStatement[];
  let assigned: MojoExpression;
  let previousValue: MojoExpression | undefined;
  if (operator !== "=") {
    if (selection.kind === "project-method") {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_METHOD_COMPOUND_WRITE_UNSUPPORTED",
        "A project method replacement supports only exact callable assignment.",
        node,
      );
      return undefined;
    }
    if (readName === undefined || readType === undefined ||
      !mojoTargetTypeEquals(readType, writeType)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_ACCESSOR_COMPOUND_WRITE_UNSUPPORTED",
        "A compound project accessor write requires one identical exact read and write carrier.",
        node,
      );
      return undefined;
    }
    const current: MojoExpression = Object.freeze({
      kind: "method-call",
      receiver: location.values[0]!,
      name: readName,
      arguments: Object.freeze(key === undefined
        ? []
        : [Object.freeze({ value: key })]),
    });
    const ordered = orderMojoValues([
      Object.freeze({ plan: mojoValue(current), type: readType, role: "property_write_current" }),
      Object.freeze({ plan: value, type: writeType, role: "property_write_value" }),
    ], context, true);
    before = Object.freeze([...location.before, ...ordered.before]);
    previousValue = ordered.values[0]!;
    assigned = Object.freeze({
      kind: "binary",
      operator: operator.slice(0, -1),
      left: previousValue,
      right: ordered.values[1]!,
    });
  } else {
    const ordered = orderMojoValues([
      Object.freeze({ plan: value, type: writeType, role: "property_write_value" }),
    ], context, true);
    before = Object.freeze([...location.before, ...ordered.before]);
    assigned = ordered.values[0]!;
  }
  return Object.freeze({
    before,
    assignedValue: assigned,
    assignedType: writeType,
    ...(previousValue === undefined ? {} : { previousValue }),
    valuePassing: writeDisposition !== undefined && mojoParameterConvention(writeDisposition) === "var"
      ? "consume"
      : "borrow",
    createWrite(argumentValue: MojoExpression): MojoStatement {
      const argument = writeDisposition !== undefined && mojoParameterConvention(writeDisposition) === "var"
        ? consumeMojoValue(argumentValue, writeType, context.program.lifecycle)
        : argumentValue;
      return Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "method-call",
          receiver: location.values[0]!,
          name: writeName,
          arguments: Object.freeze([
            ...(key === undefined ? [] : [Object.freeze({ value: key })]),
            Object.freeze({ value: argument }),
          ]),
        }),
      });
    },
  });
}

function selectedDispatchField(
  receiverType: import("../../../target-model/types/model.js").MojoTargetTypeRef,
  declarations: readonly Node[],
  context: MojoPlanningContext,
) {
  const matches = declarations.map((declaration) =>
    context.program.projectDispatch.fieldFor(receiverType, declaration))
    .filter((field): field is NonNullable<typeof field> => field !== undefined);
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : undefined;
}

export function planMojoProviderPropertyMethodWrite(
  node: Node,
  value: MojoValuePlan,
  operator: string,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoPreparedMutation | undefined {
  const selection = context.program.queries.propertySelection(node);
  if (selection?.kind !== "provider") return undefined;
  const write = selection.writeOperation;
  if (write?.target.kind !== "property-write" || write.receiverType === undefined ||
    write.parameterTypes.length !== 1) return undefined;
  const target = write.target;
  if (target.access.kind !== "method") return undefined;
  const writeName = target.access.name;
  if (selection.optionalChain) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_OPTIONAL_PROPERTY_METHOD_WRITE_UNSUPPORTED",
      "An optional property assignment has no exact JavaScript write semantics.",
      node,
    );
    return undefined;
  }
  const prepared = prepareMojoReceiver(
    selection.receiver,
    selection.sourceReceiverType,
    false,
    context,
    planValue,
  );
  const converted = prepared === undefined || selection.receiverConversion === undefined
    ? undefined
    : convertMojoValue(prepared.plan, selection.receiverConversion, context);
  if (prepared === undefined || converted === undefined) return undefined;
  const location = orderMojoValues([
    Object.freeze({ plan: converted, type: write.receiverType, role: "property_write_receiver" }),
  ], context, true);
  let before: readonly MojoStatement[] = location.before;
  let assigned: MojoExpression;
  let previousValue: MojoExpression | undefined;
  const orderedValue = orderMojoValues([
    Object.freeze({ plan: value, type: write.parameterTypes[0]!, role: "property_write_value" }),
  ], context, true);
  if (operator !== "=") {
    const read = selection.readOperation;
    if (read?.target.kind !== "property-read" || read.receiverType === undefined ||
      selection.readResultConversion === undefined ||
      !mojoTargetTypeEquals(read.receiverType, write.receiverType)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_PROPERTY_METHOD_COMPOUND_WRITE_UNSUPPORTED",
        "A method-backed compound property write requires one compatible exact read operation.",
        node,
      );
      return undefined;
    }
    const rawRead: MojoExpression = read.target.access.kind === "member"
      ? Object.freeze({ kind: "member", receiver: location.values[0]!, name: read.target.access.name })
      : read.target.access.kind === "method"
        ? Object.freeze({
            kind: "method-call",
            receiver: location.values[0]!,
            name: read.target.access.name,
            arguments: Object.freeze([]),
          })
        : Object.freeze({
            kind: "call",
            callee: mojoModuleMemberExpression(
              context,
              read.target.access.modulePath,
              read.target.access.name,
            ),
            arguments: Object.freeze([Object.freeze({ value: location.values[0]! })]),
          });
    const current = convertMojoValue(
      mojoValue(rawRead),
      selection.readResultConversion,
      context,
    );
    if (current === undefined) return undefined;
    const orderedCurrent = orderMojoValues([
      Object.freeze({
        plan: current,
        type: mojoConvertedValueType(read.resultType, selection.readResultConversion),
        role: "property_write_current",
      }),
    ], context, true);
    before = Object.freeze([
      ...before,
      ...orderedCurrent.before,
      ...orderedValue.before,
    ]);
    previousValue = orderedCurrent.values[0]!;
    assigned = Object.freeze({
      kind: "binary",
      operator: operator.slice(0, -1),
      left: previousValue,
      right: orderedValue.values[0]!,
    });
  } else {
    before = Object.freeze([...before, ...orderedValue.before]);
    assigned = orderedValue.values[0]!;
  }
  return Object.freeze({
    before,
    assignedValue: assigned,
    assignedType: write.parameterTypes[0]!,
    ...(previousValue === undefined ? {} : { previousValue }),
    valuePassing: target.value.convention === "var" ? "consume" : "borrow",
    createWrite(argumentValue: MojoExpression): MojoStatement {
      const argument = target.value.convention === "var"
        ? consumeMojoValue(argumentValue, write.parameterTypes[0]!, context.program.lifecycle)
        : argumentValue;
      return Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "method-call",
          receiver: location.values[0]!,
          name: writeName,
          arguments: Object.freeze([Object.freeze({
            value: argument,
            ...(target.value.position === "keyword"
              ? { name: target.value.nativeName! }
              : {}),
          })]),
        }),
      });
    },
  });
}
