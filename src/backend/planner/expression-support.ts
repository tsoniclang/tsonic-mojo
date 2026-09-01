import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedCallArgument,
  MojoSelectedProviderOperation,
  MojoValueConversion,
} from "../../analysis/program/model.js";
import { mojoTargetTypeEquals } from "../../target-model/provider/equality.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoStatement,
} from "../target-ast/nodes.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  registerMojoModuleImport,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import { mojoTypeName, registerMojoTypeImports } from "./types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export type MojoValuePlanner = (
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
) => MojoValuePlan | undefined;

export interface OrderedMojoValue {
  readonly plan: MojoValuePlan;
  readonly type: MojoTargetTypeRef;
  readonly role: string;
}

export interface PlannedMojoCallArgument {
  readonly plan: MojoValuePlan;
  readonly type: MojoTargetTypeRef;
  readonly name?: string;
  readonly spread: boolean;
}

export type PreparedMojoReceiver =
  | { readonly kind: "required"; readonly plan: MojoValuePlan }
  | {
      readonly kind: "optional";
      readonly before: readonly MojoStatement[];
      readonly condition: MojoExpression;
      readonly plan: MojoValuePlan;
    };

export function planProviderConstant(
  operation: MojoSelectedProviderOperation,
  resultConversion: MojoValueConversion,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (operation.target.kind !== "constant") return undefined;
  registerMojoModuleImport(context, operation.target.modulePath);
  return applyMojoConversion(
    {
      kind: "path",
      path: [...operation.target.modulePath, operation.target.name].join("."),
    },
    resultConversion,
    context,
  );
}

export function planSelectedArgument(
  argument: MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PlannedMojoCallArgument | undefined {
  const expression = planValue(argument.expression, context);
  if (expression === undefined) return undefined;
  const converted = applyMojoConversion(expression.value, argument.conversion, context);
  if (converted === undefined) return undefined;
  const value: MojoExpression = argument.passing === "consume"
    ? { kind: "consume", expression: converted }
    : converted;
  return Object.freeze({
    plan: withMojoValue(expression.before, value),
    type: argument.parameterType,
    ...(argument.position === "keyword" ? { name: argument.nativeName! } : {}),
    spread: argument.spread,
  });
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
    })),
  ], context);
  const offset = receiver === undefined ? 0 : 1;
  return Object.freeze({
    before: ordered.before,
    ...(receiver === undefined ? {} : { receiver: ordered.values[0]! }),
    arguments: Object.freeze(arguments_.map((argument, index) => Object.freeze({
      value: ordered.values[index + offset]!,
      ...(argument.name === undefined ? {} : { name: argument.name }),
      ...(argument.spread ? { spread: true } : {}),
    }))),
  });
}

export function orderMojoValues(
  values: readonly OrderedMojoValue[],
  context: MojoPlanningContext,
  stabilizeAll = false,
): { readonly before: readonly MojoStatement[]; readonly values: readonly MojoExpression[] } {
  let finalPreludeIndex = -1;
  for (const [index, value] of values.entries()) {
    if (value.plan.before.length !== 0) finalPreludeIndex = index;
  }
  const before: MojoStatement[] = [];
  const expressions: MojoExpression[] = [];
  for (const [index, value] of values.entries()) {
    before.push(...value.plan.before);
    if (stabilizeAll || index < finalPreludeIndex) {
      registerMojoTypeImports(value.type, context);
      const name = allocateMojoSyntheticName(context, value.role);
      before.push(Object.freeze({
        kind: "variable",
        name,
        type: value.type,
        initializer: value.plan.value,
      }));
      expressions.push(Object.freeze({ kind: "path", path: name }));
    } else {
      expressions.push(value.plan.value);
    }
  }
  return Object.freeze({
    before: Object.freeze(before),
    values: Object.freeze(expressions),
  });
}

export function convertMojoValue(
  plan: MojoValuePlan,
  conversion: MojoValueConversion,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  const converted = applyMojoConversion(plan.value, conversion, context);
  return converted === undefined ? undefined : withMojoValue(plan.before, converted);
}

export function prepareMojoReceiver(
  expression: Node,
  selectedType: MojoTargetTypeRef,
  optionalChain: boolean,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PreparedMojoReceiver | undefined {
  const receiver = planValue(expression, context);
  if (receiver === undefined) return undefined;
  if (!optionalChain) return Object.freeze({ kind: "required", plan: receiver });
  const actualType = context.program.queries.expressionType(expression);
  if (actualType?.kind !== "optional" || !mojoTargetTypeEquals(actualType.value, selectedType)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OPTIONAL_RECEIVER_CARRIER_UNPROVEN",
      "Optional chaining requires one exact Optional[T] receiver whose T matches the checker-selected non-null receiver.",
      expression,
    );
    return undefined;
  }
  registerMojoTypeImports(actualType, context);
  const receiverName = allocateMojoSyntheticName(context, "optional_receiver");
  const receiverPath: MojoExpression = Object.freeze({ kind: "path", path: receiverName });
  return Object.freeze({
    kind: "optional",
    before: Object.freeze([
      ...receiver.before,
      Object.freeze({
        kind: "variable",
        name: receiverName,
        type: actualType,
        initializer: receiver.value,
      }),
    ]),
    condition: receiverPath,
    plan: mojoValue(Object.freeze({
      kind: "method-call",
      receiver: receiverPath,
      name: "value",
      arguments: Object.freeze([]),
    })),
  });
}

export function finishOptionalMojoOperation(
  expression: Node,
  receiver: PreparedMojoReceiver,
  operation: MojoValuePlan,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (receiver.kind === "required") return operation;
  const resultType = context.program.queries.expressionType(expression);
  if (resultType?.kind !== "optional") {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OPTIONAL_RESULT_CARRIER_UNPROVEN",
      "Optional chaining requires one exact Optional[T] result carrier.",
      expression,
    );
    return undefined;
  }
  registerMojoTypeImports(resultType, context);
  const resultName = allocateMojoSyntheticName(context, "optional_result");
  const resultPath: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  return withMojoValue([
    ...receiver.before,
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: resultType,
      initializer: Object.freeze({
        kind: "construct",
        type: resultType,
        arguments: Object.freeze([]),
      }),
    }),
    Object.freeze({
      kind: "if",
      condition: receiver.condition,
      thenStatements: Object.freeze([
        ...operation.before,
        Object.freeze({
          kind: "assignment",
          operator: "=",
          left: resultPath,
          right: operation.value,
        }),
      ]),
    }),
  ], resultPath);
}

export function unsupportedOptionalCall(
  node: Node,
  context: MojoPlanningContext,
): undefined {
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_OPTIONAL_CALLABLE_VALUE_UNSUPPORTED",
    "An optional call without an exact receiver requires a sealed callable-value representation.",
    node,
  );
  return undefined;
}

export function requiredConversion(
  expression: Node,
  expectedType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoValueConversion | undefined {
  const conversion = context.program.queries.expressionConversion(expression, expectedType);
  if (conversion === undefined) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_VALUE_CONVERSION_PLAN_MISSING",
      "Expression use has no sealed Mojo conversion classification.",
      expression,
    );
  }
  return conversion;
}

export function applyMojoConversion(
  expression: MojoExpression,
  conversion: MojoValueConversion | undefined,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (conversion === undefined) return undefined;
  switch (conversion.kind) {
    case "identity": return expression;
    case "js-to-native-string":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return { kind: "method-call", receiver: expression, name: "to_native_strict", arguments: Object.freeze([]) };
    case "native-to-js-string":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
    case "primitive-cast":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
    case "optional-none":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([]) };
    case "optional-some":
    case "union-inject":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
  }
}

export function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

export function requiredMojoTypeName(
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): string {
  const name = mojoTypeName(type, context.module.modulePath);
  if (name === undefined) throw new Error("A Mojo unit type cannot own a static method.");
  return name;
}
