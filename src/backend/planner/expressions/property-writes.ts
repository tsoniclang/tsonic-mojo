import type { Node } from "@tsonic/tsts";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import {
  convertMojoValue,
  orderMojoValues,
  prepareMojoReceiver,
} from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, mojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import type { MojoPreparedMutation } from "./mutation-plan.js";
import { planDictionaryKey } from "./conditional-values.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";
import { mojoConvertedValueType } from "../../../analysis/operations/call-results.js";

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
    : selectedMojoDispatchField(selection.receiverType, declarations, context);
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

export function selectedMojoDispatchField(
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

