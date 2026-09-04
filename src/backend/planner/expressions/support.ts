import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedCallArgument,
} from "../../../analysis/program/model.js";
import type {
  MojoSelectedProviderOperation,
} from "../../../target-model/operations/selection.js";
import type {
  MojoValueConversion,
} from "../../../target-model/conversions/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoStatement,
} from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoCallableExpression } from "./callables.js";
import { adaptMojoRaisingCallableError } from "./callable-error-adapter.js";
import { mojoNumericLiteralCanInitialize } from "../../../target-model/types/numeric-literals.js";
import {
  convertMojoCollection,
  convertMojoNarrowedUnion,
  convertMojoOptional,
  convertMojoOptionalToUnion,
  convertMojoTruthiness,
  convertMojoUnion,
  convertMojoUnionToOptional,
  planMojoTruthiness,
} from "./conversion-support.js";
import { boxNativeStringAsJsValue, isJsArray } from "./js-carriers.js";

export type MojoValuePlanner = (
  node: Node,
  context: MojoPlanningContext,
  expectedType?: MojoTargetTypeRef,
) => MojoValuePlan | undefined;

export interface OrderedMojoValue {
  readonly plan: MojoValuePlan;
  readonly type: MojoTargetTypeRef;
  readonly role: string;
  readonly stabilize?: boolean;
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
): MojoValuePlan | undefined {
  if (operation.target.kind !== "constant" && operation.target.kind !== "function-read") return undefined;
  const selected: MojoExpression = operation.target.kind === "constant"
    ? mojoModuleMemberExpression(context, operation.target.modulePath, operation.target.name)
    : {
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          operation.target.modulePath,
          operation.target.name,
        ),
        arguments: Object.freeze([]),
      };
  return convertMojoValue(mojoValue(selected), resultConversion, context);
}

export function planSelectedArgument(
  argument: MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  preparedExpression?: MojoValuePlan,
): PlannedMojoCallArgument | undefined {
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
    if ((value.stabilize === true || stabilizeAll || index < finalPreludeIndex) &&
      !isStableMojoLocation(value.plan.value) &&
      !isTriviallyPureMojoValue(value.plan.value)) {
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

export function isTriviallyPureMojoValue(expression: MojoExpression): boolean {
  switch (expression.kind) {
    case "number-literal":
    case "bool-literal":
    case "none-literal":
    case "string-literal":
    case "type-value": return true;
    case "construct": return expression.type.kind === "source-primitive" &&
      expression.arguments.every((argument) => argument.name === undefined &&
        argument.spread !== true && isTriviallyPureMojoValue(argument.value));
    default: return false;
  }
}

function isStableMojoLocation(expression: MojoExpression): boolean {
  switch (expression.kind) {
    case "path":
    case "qualified-path":
    case "type-value": return true;
    case "member": return isStableMojoLocation(expression.receiver);
    case "element": return isStableMojoLocation(expression.receiver);
    case "postfix-deref": return true;
    default: return false;
  }
}

export function convertMojoValue(
  plan: MojoValuePlan,
  conversion: MojoValueConversion,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (conversion.kind === "js-truthiness") {
    return convertMojoTruthiness(plan, conversion.conversion, context);
  }
  if (conversion.kind === "collection-map") {
    return convertMojoCollection(plan, conversion, context, convertMojoValue);
  }
  if (conversion.kind === "optional-some") {
    const value = convertMojoValue(plan, conversion.valueConversion, context);
    if (value === undefined) return undefined;
    registerMojoTypeImports(conversion.targetType, context);
    return withMojoValue(value.before, Object.freeze({
      kind: "construct",
      type: conversion.targetType,
      arguments: Object.freeze([{ value: value.value }]),
    }));
  }
  if (conversion.kind === "optional-map") {
    return convertMojoOptional(plan, conversion, context, convertMojoValue);
  }
  if (conversion.kind === "optional-present") {
    const converted = convertMojoValue(mojoValue(Object.freeze({
      kind: "method-call",
      receiver: plan.value,
      name: "value",
      arguments: Object.freeze([]),
    })), conversion.valueConversion, context);
    return converted === undefined
      ? undefined
      : withMojoValue([...plan.before, ...converted.before], converted.value);
  }
  if (conversion.kind === "optional-to-union") {
    return convertMojoOptionalToUnion(plan, conversion, context, convertMojoValue);
  }
  if (conversion.kind === "union-to-optional") {
    return convertMojoUnionToOptional(plan, conversion, context, convertMojoValue);
  }
  if (conversion.kind === "union-inject") {
    const value = convertMojoValue(plan, conversion.valueConversion, context);
    if (value === undefined) return undefined;
    registerMojoTypeImports(conversion.targetType, context);
    return withMojoValue(value.before, Object.freeze({
      kind: "construct",
      type: conversion.targetType,
      arguments: Object.freeze([{ value: value.value }]),
    }));
  }
  if (conversion.kind === "union-map") {
    return convertMojoUnion(plan, conversion, context, convertMojoValue);
  }
  if (conversion.kind === "narrowed-union-map") {
    return convertMojoNarrowedUnion(plan, conversion, context, convertMojoValue);
  }
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
      `Expression '${context.program.source.ast.kindName(expression)}' has no sealed Mojo conversion classification for '${JSON.stringify(expectedType)}'.`,
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
    case "project-view": {
      const selected = context.program.projectDispatch.conversionFor(
        conversion.sourceType,
        conversion.targetType,
      );
      if (selected === undefined) return undefined;
      return Object.freeze({
        kind: "method-call",
        receiver: expression,
        name: selected.name,
        arguments: Object.freeze([]),
      });
    }
    case "callable-adapt": {
      registerMojoTypeImports(conversion.targetType, context);
      if (conversion.targetType.kind !== "callable") return undefined;
      const argumentTuple = Object.freeze({
        kind: "tuple" as const,
        elements: Object.freeze(conversion.targetType.parameters.map((parameter) => parameter.type)),
      });
      const resultType = conversion.targetType.result.kind === "unit"
        ? Object.freeze({
            kind: "target-named" as const,
            id: "mojo.builtin.NoneType",
            modulePath: Object.freeze([]),
            name: "NoneType",
          })
        : conversion.targetType.result;
      const targetError = conversion.targetType.errorType ?? Object.freeze({
        kind: "target-named" as const,
        id: "mojo.builtin.Error",
        modulePath: Object.freeze([]),
        name: "Error",
      });
      let adapted = expression;
      if (conversion.result === "never") {
        const sourceRaises = conversion.sourceErrorType !== undefined;
        const sourceError = conversion.sourceErrorType ?? targetError;
        adapted = Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            ["tsonic_runtime"],
            sourceRaises
              ? "adapt_raising_callable_never_result"
              : "adapt_callable_never_result",
          ),
          genericArguments: Object.freeze([
            Object.freeze({ kind: "type" as const, type: argumentTuple }),
            Object.freeze({ kind: "type" as const, type: resultType }),
            ...(sourceRaises
              ? [Object.freeze({ kind: "type" as const, type: sourceError })]
              : []),
          ]),
          arguments: Object.freeze([{ value: adapted }]),
        });
      }
      if (conversion.error === "widen") {
        if (conversion.sourceErrorType !== undefined) {
          if (conversion.errorConversion === undefined) return undefined;
          const sourceType = Object.freeze({
            ...conversion.targetType,
            raises: true,
            errorType: conversion.sourceErrorType,
          });
          return adaptMojoRaisingCallableError(
            adapted,
            sourceType,
            conversion.targetType,
            conversion.errorConversion,
            context,
            convertMojoValue,
          );
        }
        return Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "widen_callable"),
          genericArguments: Object.freeze([
            Object.freeze({ kind: "type" as const, type: argumentTuple }),
            Object.freeze({ kind: "type" as const, type: resultType }),
            Object.freeze({ kind: "type" as const, type: targetError }),
          ]),
          arguments: Object.freeze([{ value: adapted }]),
        });
      }
      if (conversion.error === "erase") {
        return Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "erase_callable_error"),
          arguments: Object.freeze([{ value: adapted }]),
        });
      }
      return adapted;
    }
    case "js-truthiness":
      return planMojoTruthiness(expression, conversion.conversion, context);
    case "js-callback-truthiness": {
      registerMojoTypeImports(conversion.targetType, context);
      const callable = conversion.widenRaises
        ? Object.freeze({
            kind: "call" as const,
            callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "widen_callable"),
            arguments: Object.freeze([{ value: expression }]),
          })
        : expression;
      return Object.freeze({
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_js"],
          `adapt_truthy_${conversion.source.replace(/-/gu, "_")}_callback`,
        ),
        arguments: Object.freeze([{ value: callable }]),
      });
    }
    case "js-to-native-string":
      return { kind: "method-call", receiver: expression, name: "to_native_strict", arguments: Object.freeze([]) };
    case "native-error-result-unwrap":
      registerMojoTypeImports(conversion.sourceType, context);
      registerMojoTypeImports(conversion.targetType, context);
      return {
        kind: "method-call",
        receiver: expression,
        name: "unwrap",
        arguments: Object.freeze([]),
      };
    case "native-to-js-string":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
    case "collection-map":
    case "optional-map":
    case "optional-to-union":
    case "union-to-optional":
    case "union-map":
    case "narrowed-union-map":
      return undefined;
    case "js-box":
      if (conversion.source === "native-string") return boxNativeStringAsJsValue(expression, context);
      return {
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_js"],
          `js_value_from_${conversion.source}`,
        ),
        arguments: conversion.source === "null" || conversion.source === "undefined"
          ? Object.freeze([])
          : Object.freeze([{ value: expression }]),
      };
    case "primitive-cast":
    case "reference-copy":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
    case "optional-none":
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([]) };
    case "optional-some": {
      const value = applyMojoConversion(expression, conversion.valueConversion, context);
      if (value === undefined) return undefined;
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value }]) };
    }
    case "optional-present": {
      const present = Object.freeze({
        kind: "method-call" as const,
        receiver: expression,
        name: "value",
        arguments: Object.freeze([]),
      });
      return applyMojoConversion(present, conversion.valueConversion, context);
    }
    case "union-inject": {
      const value = applyMojoConversion(expression, conversion.valueConversion, context);
      if (value === undefined) return undefined;
      registerMojoTypeImports(conversion.targetType, context);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value }]) };
    }
  }
}
