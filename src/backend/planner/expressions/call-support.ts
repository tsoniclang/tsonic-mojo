import type { MojoAnalyzedCallArgument } from "../../../analysis/program/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import { mojoNumericLiteralCanInitialize } from "../../../target-model/types/numeric-literals.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoCallArgument, MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoCallableExpression } from "./callables.js";
import { planMojoImmediateCallable } from "./immediate-callables.js";
import { isJsArray } from "./js-carriers.js";
import {
  convertMojoValue,
  orderMojoValues,
} from "./support.js";
import type {
  MojoValuePlanner,
  OrderedMojoValue,
  PlannedMojoCallArgument,
} from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planSelectedArgument(
  argument: MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  preparedExpression?: MojoValuePlan,
): PlannedMojoCallArgument | undefined {
  if (argument.locationBorrow !== undefined) {
    const storage = context.program.queries.locationStorage(argument.locationBorrow.declaration);
    if (storage === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_LOCATION_ARGUMENT_STORAGE_MISSING",
        "A sealed location-backed call argument has no promoted Mojo storage.",
        argument.expression,
      );
      return undefined;
    }
    if (!mojoTargetTypeEquals(storage.valueType, argument.parameterType)) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_LOCATION_ARGUMENT_STORAGE_TYPE_CONFLICT",
        "A sealed location-backed call argument disagrees with its promoted storage carrier.",
        argument.expression,
      );
      return undefined;
    }
    return Object.freeze({
      plan: mojoValue(Object.freeze({
        kind: "method-call",
        receiver: Object.freeze({ kind: "path", path: storage.name }),
        name: argument.locationBorrow.mutability === "mutable" ? "borrow_mut" : "borrow",
        arguments: Object.freeze([]),
      })),
      type: argument.parameterType,
      ...(argument.position === "keyword" ? { name: argument.nativeName! } : {}),
      spread: false,
      borrowProjection: true,
    });
  }
  if (argument.callableConsumption === "immediate") {
    const plan = planMojoImmediateCallable(argument, context, planValue);
    return plan === undefined
      ? undefined
      : Object.freeze({
          plan,
          type: argument.parameterType,
          ...(argument.position === "keyword" ? { name: argument.nativeName! } : {}),
          spread: false,
        });
  }
  const directCallableAdaptation = preparedExpression === undefined &&
    argument.sourceForm === "value" && argument.conversion.kind === "callable-adapt" &&
    argument.conversion.error !== "erase" &&
    (context.program.source.ast.is.IsArrowFunction(argument.expression) ||
      context.program.source.ast.is.IsFunctionExpression(argument.expression));
  const directNumericConversion = preparedExpression === undefined &&
    argument.sourceForm === "value" && context.program.source.ast.is.IsNumericLiteral(argument.expression) &&
    argument.conversion.kind === "primitive-cast" &&
    mojoNumericLiteralCanInitialize(
      context.program.source.ast.text(argument.expression),
      argument.conversion.targetType,
    );
  const expression = preparedExpression ?? (directNumericConversion && argument.conversion.kind === "primitive-cast"
    ? mojoValue(Object.freeze({
        kind: "construct",
        type: argument.conversion.targetType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "number-literal",
            text: context.program.source.ast.text(argument.expression),
          }),
        })]),
      }))
    : directCallableAdaptation
      ? planMojoCallableExpression(
        argument.expression,
        context,
        planValue,
        argument.conversion.kind === "callable-adapt" &&
            argument.conversion.targetType.kind === "callable"
          ? argument.conversion.targetType
          : undefined,
      )
      : planValue(argument.expression, context));
  if (expression === undefined) return undefined;
  const converted = directCallableAdaptation || directNumericConversion
    ? expression
    : convertMojoValue(expression, argument.conversion, context);
  if (converted === undefined) return undefined;
  const value: MojoExpression = argument.disposition.kind === "transfer"
    ? consumeMojoValue(converted.value, argument.parameterType, context.program.lifecycle)
    : argument.disposition.kind === "copy"
      ? {
          kind: "method-call",
          receiver: converted.value,
          name: "copy",
          arguments: Object.freeze([]),
        }
      : converted.value;
  return Object.freeze({
    plan: withMojoValue(converted.before, value),
    type: argument.parameterType,
    ...(argument.position === "keyword" ? { name: argument.nativeName! } : {}),
    spread: argument.spread,
  });
}

export function planSelectedArguments(
  arguments_: readonly MojoAnalyzedCallArgument[],
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): readonly PlannedMojoCallArgument[] | undefined {
  const spreadSources = new Map<number, {
    readonly name: string;
    readonly type: MojoTargetTypeRef;
    readonly before: readonly MojoStatement[];
  }>();
  const emittedSpreadSources = new Set<number>();
  const planned: PlannedMojoCallArgument[] = [];
  for (const argument of arguments_) {
    let prepared: MojoValuePlan | undefined;
    if (argument.sourceForm === "spread-element") {
      if (argument.sourceContainerType === undefined || argument.spreadElementIndex === undefined) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_SPREAD_ELEMENT_PLAN_INCOMPLETE",
          "A selected spread element has no exact aggregate carrier and ordinal.",
          argument.expression,
        );
        return undefined;
      }
      let source = spreadSources.get(argument.sourceArgumentIndex);
      if (source === undefined) {
        const value = planValue(argument.expression, context, argument.sourceContainerType);
        if (value === undefined) return undefined;
        registerMojoTypeImports(argument.sourceContainerType, context);
        const name = allocateMojoSyntheticName(context, "spread_argument");
        source = {
          name,
          type: argument.sourceContainerType,
          before: Object.freeze([
            ...value.before,
            Object.freeze({
              kind: "variable" as const,
              name,
              type: argument.sourceContainerType,
              initializer: value.value,
            }),
          ]),
        };
        spreadSources.set(argument.sourceArgumentIndex, source);
      } else if (!mojoTargetTypeEquals(source.type, argument.sourceContainerType)) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_SPREAD_ELEMENT_CARRIER_CONFLICT",
          "One authored spread argument was selected through incompatible aggregate carriers.",
          argument.expression,
        );
        return undefined;
      }
      prepared = withMojoValue(
        emittedSpreadSources.has(argument.sourceArgumentIndex)
          ? Object.freeze([])
          : source.before,
        Object.freeze({
          kind: "element",
          receiver: Object.freeze({ kind: "path", path: source.name }),
          index: Object.freeze({
            kind: "number-literal",
            text: String(argument.spreadElementIndex),
          }),
        }),
      );
      emittedSpreadSources.add(argument.sourceArgumentIndex);
    }
    const result = planSelectedArgument(argument, context, planValue, prepared);
    if (result === undefined) return undefined;
    planned.push(result);
  }
  return Object.freeze(planned);
}

export function orderCallArguments(
  arguments_: readonly PlannedMojoCallArgument[],
  context: MojoPlanningContext,
  receiver?: OrderedMojoValue,
): {
  readonly before: readonly MojoStatement[];
  readonly receiver?: MojoExpression;
  readonly arguments: readonly MojoCallArgument[];
} {
  const ordered = orderMojoValues([
    ...(receiver === undefined ? [] : [receiver]),
    ...arguments_.map((argument) => Object.freeze({
      plan: argument.plan,
      type: argument.type,
      role: "call_argument",
      ...(argument.borrowProjection === true ? { stabilize: false as const } : {}),
    })),
  ], context);
  const offset = receiver === undefined ? 0 : 1;
  return Object.freeze({
    before: ordered.before,
    ...(receiver === undefined ? {} : { receiver: ordered.values[0]! }),
    arguments: Object.freeze(arguments_.map((argument, index) => {
      const orderedValue = ordered.values[index + offset]!;
      const value = argument.spread && isJsArray(argument.type)
        ? Object.freeze({
            kind: "method-call" as const,
            receiver: orderedValue,
            name: "iter_values",
            arguments: Object.freeze([]),
          })
        : orderedValue;
      return Object.freeze({
        value,
        ...(argument.name === undefined ? {} : { name: argument.name }),
        ...(argument.spread ? { spread: true } : {}),
      });
    })),
  });
}
