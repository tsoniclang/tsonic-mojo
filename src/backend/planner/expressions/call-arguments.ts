import type {
  MojoAnalyzedCallArgument,
  MojoCallableArgumentSlot,
} from "../../../analysis/program/call-model.js";
import type { MojoArgumentDisposition } from "../../../analysis/representations/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import {
  orderMojoValues,
  planSelectedArgument,
  planSelectedArguments,
} from "./support.js";
import type { MojoValuePlanner, PlannedMojoCallArgument } from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";

export function applyArgumentDisposition(
  expression: MojoExpression,
  disposition: MojoArgumentDisposition | undefined,
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression {
  switch (disposition?.kind ?? "plain") {
    case "plain": return expression;
    case "copy": return Object.freeze({ kind: "copy", expression });
    case "transfer": return consumeMojoValue(expression, type, context.program.lifecycle);
  }
}

export function planCallableArgumentSlot(
  slot: MojoCallableArgumentSlot,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  plannedArguments?: ReadonlyMap<MojoAnalyzedCallArgument, PlannedMojoCallArgument>,
): PlannedMojoCallArgument | undefined {
  if (slot.kind === "value") {
    return plannedArguments?.get(slot.argument) ??
      planSelectedArgument(slot.argument, context, planValue);
  }
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
  const items = plannedArguments === undefined
    ? planSelectedArguments(slot.arguments, context, planValue)
    : slot.arguments.map((argument) => plannedArguments.get(argument));
  if (items === undefined || items.some((item) => item === undefined)) return undefined;
  const ordered = orderMojoValues((items as readonly PlannedMojoCallArgument[]).map((item) => Object.freeze({
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
  const nativeList = consumeMojoValue(
    Object.freeze({ kind: "path", path: listName }),
    listType,
    context.program.lifecycle,
  );
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
  type: MojoTargetTypeRef,
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
