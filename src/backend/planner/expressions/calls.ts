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
  prepareMojoReceiver,
  unsupportedOptionalCall,
} from "./support.js";
import { orderCallArguments, planSelectedArguments } from "./call-support.js";
import type {
  MojoValuePlanner,
  PlannedMojoCallArgument,
} from "./support.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoIntrinsicCall } from "./intrinsic-calls.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { applyArgumentDisposition, planCallableArgumentSlot } from "./call-arguments.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import {
  planMojoJsonStringify,
  planMojoObjectAssign,
} from "./source-profile-special-calls.js";
import { planMojoProjectConstruction } from "./project-construction.js";

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
  if (selection.kind === "source-intrinsic" ||
    selection.kind === "explicit-safety" ||
    selection.kind === "native-pointer" ||
    selection.kind === "raw-pointer" ||
    selection.kind === "typed-location") {
    return planMojoIntrinsicCall(selection, node, context, planValue);
  }
  if (selection.kind === "object-assign") {
    return planMojoObjectAssign(selection, context, planValue);
  }
  if (selection.kind === "json-stringify") {
    return planMojoJsonStringify(selection, context, planValue);
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
        const requiresSpecialization = selection.target.adapterDeclaration === undefined &&
          context.program.sourceCallableSpecializations
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
          ? selection.target.adapterDeclaration !== undefined
            ? selection.target.name
            : context.program.projectDispatch.implementationName(
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
        const ordered = orderCallArguments(plannedArguments, context);
        before = ordered.before;
        call = planMojoProjectConstruction(
          selection.target.construction,
          ordered.arguments,
          context,
        );
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
  let preparedFunctionReceiver: ReturnType<typeof prepareMojoReceiver> = undefined;
  if (target.kind === "function-call") {
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
      preparedFunctionReceiver = prepareMojoReceiver(
        selection.receiver,
        selection.sourceReceiverType,
        selection.optionalChain,
        context,
        planValue,
      );
      convertedReceiver = preparedFunctionReceiver === undefined
        ? undefined
        : convertMojoValue(preparedFunctionReceiver.plan, selection.receiverConversion, context);
      if (preparedFunctionReceiver === undefined || convertedReceiver === undefined) return undefined;
    } else if (selection.optionalChain) {
      return unsupportedOptionalCall(node, context);
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
  const converted = convertMojoValue(
    withMojoValue(before, call),
    selection.resultConversion,
    context,
  );
  if (converted === undefined) return undefined;
  return preparedFunctionReceiver !== undefined
    ? finishOptionalMojoOperation(node, preparedFunctionReceiver, converted, context)
    : converted;
}
