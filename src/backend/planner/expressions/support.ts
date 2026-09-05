import type { Node } from "@tsonic/tsts";
import type {
  MojoSelectedProviderOperation,
} from "../../../target-model/operations/selection.js";
import type {
  MojoValueConversion,
} from "../../../target-model/conversions/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
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
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { convertMojoJsonValue } from "./js-value-conversions.js";
import { adaptMojoRaisingCallableError } from "./callable-error-adapter.js";
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
import { boxNativeStringAsJsValue } from "./js-carriers.js";

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
  readonly use?: "value" | "location";
  readonly typeAnnotation?: "inferred";
}

export interface PlannedMojoCallArgument {
  readonly plan: MojoValuePlan;
  readonly type: MojoTargetTypeRef;
  readonly name?: string;
  readonly spread: boolean;
  readonly borrowProjection?: true;
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

export function orderMojoValues(
  values: readonly OrderedMojoValue[],
  context: MojoPlanningContext,
  stabilizeAll = false,
): { readonly before: readonly MojoStatement[]; readonly values: readonly MojoExpression[] } {
  let finalPreludeIndex = -1;
  let finalEffectIndex = -1;
  for (const [index, value] of values.entries()) {
    if (value.plan.before.length !== 0) finalPreludeIndex = index;
    if (!isReadOnlyMojoValue(value.plan.value)) finalEffectIndex = index;
  }
  const before: MojoStatement[] = [];
  const expressions: MojoExpression[] = [];
  for (const [index, value] of values.entries()) {
    before.push(...value.plan.before);
    const stable = value.use === "location"
      ? isStableMojoLocation(value.plan.value)
      : value.plan.value.kind === "path";
    if (value.stabilize !== false &&
      ((value.stabilize === true || stabilizeAll || index < finalEffectIndex) && !stable ||
        index < finalPreludeIndex && (value.use !== "location" || !stable)) &&
      !isTriviallyPureMojoValue(value.plan.value)) {
      if (value.typeAnnotation !== "inferred") registerMojoTypeImports(value.type, context);
      const name = allocateMojoSyntheticName(context, value.role);
      before.push(Object.freeze({
        kind: "variable",
        name,
        ...(value.typeAnnotation === "inferred" ? {} : { type: value.type }),
        initializer: value.typeAnnotation !== "inferred" && isStableMojoLocation(value.plan.value) &&
          context.program.lifecycle.capabilities(value.type).copy === "explicit"
          ? Object.freeze({ kind: "copy", expression: value.plan.value })
          : value.plan.value,
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

function isReadOnlyMojoValue(expression: MojoExpression): boolean {
  if (isTriviallyPureMojoValue(expression)) return true;
  switch (expression.kind) {
    case "path":
    case "qualified-path": return true;
    case "member": return isReadOnlyMojoValue(expression.receiver);
    case "element": return isReadOnlyMojoValue(expression.receiver) &&
      isReadOnlyMojoValue(expression.index);
    case "postfix-deref":
    case "parenthesized": return isReadOnlyMojoValue(expression.expression);
    case "proven-union-member": return isReadOnlyMojoValue(expression.receiver);
    case "binary": return expression.evaluation === "read-only" &&
      isReadOnlyMojoValue(expression.left) && isReadOnlyMojoValue(expression.right);
    case "construct": return expression.type.kind === "source-primitive" &&
      expression.arguments.every((argument) => argument.name === undefined &&
        argument.spread !== true && isReadOnlyMojoValue(argument.value));
    default: return false;
  }
}

export function isTriviallyPureMojoValue(expression: MojoExpression): boolean {
  switch (expression.kind) {
    case "number-literal":
    case "bool-literal":
    case "none-literal":
    case "string-literal":
    case "type-value": return true;
    case "construct": return (expression.type.kind === "null" || expression.type.kind === "undefined")
      ? expression.arguments.length === 0
      : expression.type.kind === "source-primitive" &&
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
  if (conversion.kind === "js-structural-object-box" ||
    conversion.kind === "js-sequence-box" || conversion.kind === "js-tuple-box" ||
    conversion.kind === "js-optional-box" || conversion.kind === "js-union-box" ||
    conversion.kind === "js-selected-to-json") {
    return convertMojoJsonValue(plan, conversion, context, convertMojoValue);
  }
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
    case "js-callback-truthiness": return undefined;
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
      const boxedValue = conversion.source === "number" && conversion.sourceType.name !== "float64"
        ? Object.freeze({
            kind: "construct" as const,
            type: Object.freeze({ kind: "source-primitive" as const, name: "float64" as const }),
            arguments: Object.freeze([{ value: expression }]),
          })
        : expression;
      return {
        kind: "call",
        callee: mojoModuleMemberExpression(
          context,
          ["tsonic_js"],
          `js_value_from_${conversion.source}`,
        ),
        arguments: conversion.source === "null" || conversion.source === "undefined"
          ? Object.freeze([])
          : Object.freeze([{ value: boxedValue }]),
      };
    case "js-structural-object-box":
    case "js-sequence-box":
    case "js-tuple-box":
    case "js-optional-box":
    case "js-union-box":
    case "js-selected-to-json":
      return undefined;
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
