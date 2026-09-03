import type { Node } from "@tsonic/tsts";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  convertMojoValue,
  finishOptionalMojoOperation,
  orderMojoValues,
  prepareMojoReceiver,
} from "./support.js";
import type { MojoValuePlanner } from "./support.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { applyValueRefinement } from "./leaves.js";

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
  const sourceReceiverType = selection.kind === "provider"
    ? selection.sourceReceiverType
    : selection.receiverType;
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
  if (preparedReceiver === undefined || receiver === undefined) return undefined;
  const selectedTupleSelection = selection.kind === "native" &&
    selection.selectedElementIndex !== undefined
    ? selection
    : undefined;
  const selectedTupleIndex = selectedTupleSelection?.selectedElementIndex;
  const rawIndex = selectedTupleIndex !== undefined &&
      selectedTupleSelection?.evaluateSelectedIndex !== true
    ? undefined
    : planValue(
        selection.index,
        context,
        selectedTupleSelection?.sourceIndexType,
      );
  const index = selectedTupleIndex !== undefined
    ? rawIndex
    : rawIndex === undefined
      ? undefined
      : convertMojoValue(rawIndex, selection.indexConversion, context);
  if (selectedTupleIndex === undefined && index === undefined) return undefined;
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
  const receiverType = selection.kind === "provider" ? operation?.receiverType : selection.receiverType;
  const indexType = selection.kind === "provider" ? operation?.parameterTypes[0] : selection.indexType;
  if (receiverType === undefined || indexType === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver, type: receiverType, role: "element_receiver" }),
    ...(index === undefined
      ? []
      : [Object.freeze({
          plan: index,
          type: selectedTupleSelection?.sourceIndexType ?? indexType,
          role: "element_index",
        })]),
  ], context, stabilizeComponents);
  const before = selectedTupleIndex !== undefined && ordered.values[1] !== undefined
    ? Object.freeze([
        ...ordered.before,
        Object.freeze({ kind: "discard" as const, expression: ordered.values[1] }),
      ])
    : ordered.before;
  const indexExpression: MojoExpression = selectedTupleIndex === undefined
    ? ordered.values[1]!
    : Object.freeze({ kind: "number-literal", text: String(selectedTupleIndex) });
  const projectView = selection.kind === "project-index"
    ? context.program.projectDispatch.viewForType(selection.receiverType)
    : undefined;
  const projectIndex = projectView === undefined || selection.kind !== "project-index"
    ? undefined
    : context.program.projectDispatch.indexFor(selection.receiverType, selection.declaration);
  if (projectView !== undefined && projectIndex === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_INDEX_DISPATCH_NOT_SEALED",
      "A polymorphic project index access has no exact sealed dispatch slot.",
      node,
    );
    return undefined;
  }
  if (mode === "write" && projectIndex !== undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_INDEX_WRITE_REQUIRES_VALUE",
      "A polymorphic project index write must be planned with its exact assigned value.",
      node,
    );
    return undefined;
  }
  const indexedReceiver: MojoExpression = selection.kind !== "project-index" || projectIndex !== undefined
    ? ordered.values[0]!
    : {
        kind: "member",
        receiver: {
          kind: "postfix-deref",
          expression: { kind: "member", receiver: ordered.values[0]!, name: "_state" },
        },
        name: selection.storageName,
      };
  const access: MojoExpression = projectIndex !== undefined
    ? {
        kind: "method-call",
        receiver: indexedReceiver,
        name: projectIndex.read.name,
        arguments: Object.freeze([Object.freeze({ value: indexExpression })]),
      }
    : selection.kind === "provider" &&
      operation?.target.kind === "index-read" && operation.target.access.kind === "method"
    ? {
        kind: "method-call",
        receiver: indexedReceiver,
        name: operation.target.access.name,
        arguments: Object.freeze([Object.freeze({ value: indexExpression })]),
      }
    : {
        kind: "element",
        receiver: indexedReceiver,
        index: indexExpression,
      };
  const operationPlan = mode !== "read" || selection.readResultConversion === undefined
    ? withMojoValue(before, access)
    : convertMojoValue(
        withMojoValue(before, access),
        selection.readResultConversion,
        context,
      );
  if (operationPlan === undefined) return undefined;
  const finished = finishOptionalMojoOperation(node, preparedReceiver, operationPlan, context);
  if (finished === undefined) return undefined;
  const refined = applyValueRefinement(
    finished.value,
    context.program.representations.narrowing(node),
    context,
  );
  if (refined === undefined) return undefined;
  return withMojoValue(
    finished.before,
    refined,
  );
}

export function projectElementUsesMethodWrite(
  selection: import("../../../analysis/program/model.js").MojoElementSelection | undefined,
  context: MojoPlanningContext,
): boolean {
  return selection?.kind === "project-index" &&
    context.program.projectDispatch.viewForType(selection.receiverType) !== undefined;
}

export function providerElementUsesMethodWrite(
  selection: import("../../../analysis/program/model.js").MojoElementSelection | undefined,
): boolean {
  return selection?.kind === "provider" &&
    selection.writeOperation?.target.kind === "index-write" &&
    selection.writeOperation.target.access.kind === "method";
}

export function planMojoProviderElementMethodWrite(
  node: Node,
  value: MojoValuePlan,
  operator: string,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): { readonly before: readonly MojoStatement[]; readonly statement: MojoStatement } | undefined {
  const selection = context.program.queries.elementSelection(node);
  if (selection?.kind !== "provider") return undefined;
  const write = selection.writeOperation;
  if (write?.target.kind !== "index-write" || write.target.access.kind !== "method" ||
    write.receiverType === undefined || write.parameterTypes.length !== 2) return undefined;
  if (selection.optionalChain) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROVIDER_OPTIONAL_ELEMENT_METHOD_WRITE_UNSUPPORTED",
      "An optional element assignment has no exact JavaScript write semantics.",
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
  const rawIndex = planValue(selection.index, context);
  const convertedReceiver = prepared === undefined
    ? undefined
    : convertMojoValue(prepared.plan, selection.receiverConversion, context);
  const convertedIndex = rawIndex === undefined
    ? undefined
    : convertMojoValue(rawIndex, selection.indexConversion, context);
  if (prepared === undefined || convertedReceiver === undefined || convertedIndex === undefined) {
    return undefined;
  }
  const location = orderMojoValues([
    Object.freeze({ plan: convertedReceiver, type: write.receiverType, role: "element_write_receiver" }),
    Object.freeze({ plan: convertedIndex, type: write.parameterTypes[0]!, role: "element_write_index" }),
  ], context, true);
  let before: readonly MojoStatement[] = location.before;
  let assigned: MojoExpression;
  if (operator === "=") {
    const orderedValue = orderMojoValues([
      Object.freeze({ plan: value, type: write.parameterTypes[1]!, role: "element_write_value" }),
    ], context, true);
    before = Object.freeze([...before, ...orderedValue.before]);
    assigned = orderedValue.values[0]!;
  } else {
    const read = selection.readOperation;
    if (read?.target.kind !== "index-read" || read.receiverType === undefined ||
      read.parameterTypes.length !== 1 || selection.readResultConversion === undefined ||
      !mojoTargetTypeEquals(read.receiverType, write.receiverType) ||
      !mojoTargetTypeEquals(read.parameterTypes[0]!, write.parameterTypes[0]!)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROVIDER_ELEMENT_METHOD_COMPOUND_WRITE_UNSUPPORTED",
        "A method-backed compound element write requires compatible exact read and write operations.",
        node,
      );
      return undefined;
    }
    const rawRead: MojoExpression = read.target.access.kind === "element"
      ? Object.freeze({
          kind: "element",
          receiver: location.values[0]!,
          index: location.values[1]!,
        })
      : Object.freeze({
          kind: "method-call",
          receiver: location.values[0]!,
          name: read.target.access.name,
          arguments: Object.freeze([Object.freeze({ value: location.values[1]! })]),
        });
    const current = convertMojoValue(
      mojoValue(rawRead),
      selection.readResultConversion,
      context,
    );
    if (current === undefined) return undefined;
    const orderedCurrent = orderMojoValues([
      Object.freeze({ plan: current, type: selection.readType!, role: "element_write_current" }),
    ], context, true);
    const orderedValue = orderMojoValues([
      Object.freeze({ plan: value, type: write.parameterTypes[1]!, role: "element_write_value" }),
    ], context, true);
    before = Object.freeze([
      ...before,
      ...orderedCurrent.before,
      ...orderedValue.before,
    ]);
    assigned = Object.freeze({
      kind: "binary",
      operator: operator.slice(0, -1),
      left: orderedCurrent.values[0]!,
      right: orderedValue.values[0]!,
    });
  }
  return Object.freeze({
    before,
    statement: Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "method-call",
        receiver: location.values[0]!,
        name: write.target.access.name,
        arguments: Object.freeze([
          Object.freeze({ value: location.values[1]! }),
          Object.freeze({ value: assigned }),
        ]),
      }),
    }),
  });
}

export function planMojoProjectElementWrite(
  node: Node,
  value: MojoValuePlan,
  operator: string,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): { readonly before: readonly MojoStatement[]; readonly statement: MojoStatement } | undefined {
  const selection = context.program.queries.elementSelection(node);
  if (selection?.kind !== "project-index") return undefined;
  const dispatch = context.program.projectDispatch.indexFor(
    selection.receiverType,
    selection.declaration,
  );
  if (dispatch?.write === undefined || selection.writeType === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_INDEX_WRITE_DISPATCH_NOT_SEALED",
      "A polymorphic project index write has no exact sealed writable dispatch slot.",
      node,
    );
    return undefined;
  }
  if (selection.optionalChain) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_PROJECT_OPTIONAL_INDEX_WRITE_UNSUPPORTED",
      "An optional project index assignment has no exact JavaScript write semantics.",
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
  const rawIndex = planValue(selection.index, context);
  const index = rawIndex === undefined
    ? undefined
    : convertMojoValue(rawIndex, selection.indexConversion, context);
  if (receiver === undefined || index === undefined) return undefined;
  const ordered = orderMojoValues([
    Object.freeze({ plan: receiver.plan, type: selection.receiverType, role: "index_write_receiver" }),
    Object.freeze({ plan: index, type: selection.indexType, role: "index_write_key" }),
    Object.freeze({ plan: value, type: selection.writeType, role: "index_write_value" }),
  ], context, true);
  let assigned = ordered.values[2]!;
  if (operator !== "=") {
    if (selection.readType === undefined ||
      !mojoTargetTypeEquals(selection.readType, selection.writeType)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_PROJECT_INDEX_COMPOUND_WRITE_UNSUPPORTED",
        "A compound project index write requires one identical exact read and write carrier.",
        node,
      );
      return undefined;
    }
    assigned = Object.freeze({
      kind: "binary",
      operator: operator.slice(0, -1),
      left: Object.freeze({
        kind: "method-call",
        receiver: ordered.values[0]!,
        name: dispatch.read.name,
        arguments: Object.freeze([Object.freeze({ value: ordered.values[1]! })]),
      }),
      right: assigned,
    });
  }
  return Object.freeze({
    before: ordered.before,
    statement: Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "method-call",
        receiver: ordered.values[0]!,
        name: dispatch.write.name,
        arguments: Object.freeze([
          Object.freeze({ value: ordered.values[1]! }),
          Object.freeze({ value: assigned }),
        ]),
      }),
    }),
  });
}
