import type { Node } from "@tsonic/tsts";
import type {
  MojoAnalyzedCallArgument,
} from "../../../analysis/program/model.js";
import type {
  MojoSelectedProviderOperation,
} from "../../../target-model/operations/selection.js";
import type {
  MojoValueConversion,
  MojoTruthinessConversion,
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
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoTypeName, registerMojoTypeImports } from "../types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoCallableExpression } from "./callables.js";

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
): MojoExpression | undefined {
  if (operation.target.kind !== "constant" && operation.target.kind !== "function-read") return undefined;
  registerMojoModuleImport(context, operation.target.modulePath);
  const selected: MojoExpression = operation.target.kind === "constant"
    ? {
        kind: "path",
        path: [...operation.target.modulePath, operation.target.name].join("."),
      }
    : {
        kind: "call",
        callee: Object.freeze({
          kind: "path",
          path: [...operation.target.modulePath, operation.target.name].join("."),
        }),
        arguments: Object.freeze([]),
      };
  return applyMojoConversion(
    selected,
    resultConversion,
    context,
  );
}

export function planSelectedArgument(
  argument: MojoAnalyzedCallArgument,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): PlannedMojoCallArgument | undefined {
  const directCallableWidening = argument.conversion.kind === "callable-raise-widen" &&
    (context.program.source.ast.is.IsArrowFunction(argument.expression) ||
      context.program.source.ast.is.IsFunctionExpression(argument.expression));
  const expression = directCallableWidening
    ? planMojoCallableExpression(
        argument.expression,
        context,
        planValue,
        argument.conversion.targetType.kind === "callable"
          ? argument.conversion.targetType
          : undefined,
      )
    : planValue(argument.expression, context);
  if (expression === undefined) return undefined;
  const converted = directCallableWidening
    ? expression
    : convertMojoValue(expression, argument.conversion, context);
  if (converted === undefined) return undefined;
  const value: MojoExpression = argument.passing === "consume"
    ? { kind: "consume", expression: converted.value }
    : converted.value;
  return Object.freeze({
    plan: withMojoValue(converted.before, value),
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
      !isStableMojoLocation(value.plan.value)) {
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

function isStableMojoLocation(expression: MojoExpression): boolean {
  switch (expression.kind) {
    case "path": return true;
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
    return convertMojoCollection(plan, conversion, context);
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
    return convertMojoOptional(plan, conversion, context);
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
    return convertMojoOptionalToUnion(plan, conversion, context);
  }
  if (conversion.kind === "union-to-optional") {
    return convertMojoUnionToOptional(plan, conversion, context);
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
    return convertMojoUnion(plan, conversion, context);
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
    case "callable-raise-widen":
      registerMojoModuleImport(context, ["tsonic_runtime"]);
      registerMojoTypeImports(conversion.targetType, context);
      if (conversion.targetType.kind !== "callable" || !conversion.targetType.raises) {
        return undefined;
      }
      return {
        kind: "call",
        callee: { kind: "path", path: "tsonic_runtime.widen_callable" },
        genericArguments: Object.freeze([
          Object.freeze({
            kind: "type" as const,
            type: Object.freeze({
              kind: "tuple" as const,
              elements: Object.freeze(conversion.targetType.parameters.map((parameter) => parameter.type)),
            }),
          }),
          Object.freeze({ kind: "type" as const, type: conversion.targetType.result }),
          Object.freeze({
            kind: "type" as const,
            type: conversion.targetType.errorType ?? Object.freeze({
              kind: "target-named" as const,
              id: "mojo.builtin.Error",
              modulePath: Object.freeze([]),
              name: "Error",
            }),
          }),
        ]),
        arguments: Object.freeze([{ value: expression }]),
      };
    case "callable-error-erase":
      registerMojoModuleImport(context, ["tsonic_runtime"]);
      registerMojoTypeImports(conversion.targetType, context);
      return {
        kind: "call",
        callee: { kind: "path", path: "tsonic_runtime.erase_callable_error" },
        arguments: Object.freeze([{ value: expression }]),
      };
    case "js-truthiness":
      return planMojoTruthiness(expression, conversion.conversion, context);
    case "js-callback-truthiness": {
      registerMojoModuleImport(context, ["tsonic_js"]);
      registerMojoTypeImports(conversion.targetType, context);
      const callable = conversion.widenRaises
        ? Object.freeze({
            kind: "call" as const,
            callee: Object.freeze({ kind: "path" as const, path: "tsonic_runtime.widen_callable" }),
            arguments: Object.freeze([{ value: expression }]),
          })
        : expression;
      if (conversion.widenRaises) registerMojoModuleImport(context, ["tsonic_runtime"]);
      return Object.freeze({
        kind: "call",
        callee: Object.freeze({
          kind: "path",
          path: `tsonic_js.adapt_truthy_${conversion.source.replace(/-/gu, "_")}_callback`,
        }),
        arguments: Object.freeze([{ value: callable }]),
      });
    }
    case "js-to-native-string":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return { kind: "method-call", receiver: expression, name: "to_native_strict", arguments: Object.freeze([]) };
    case "native-to-js-string":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return { kind: "construct", type: conversion.targetType, arguments: Object.freeze([{ value: expression }]) };
    case "collection-map":
    case "optional-map":
    case "optional-to-union":
    case "union-to-optional":
    case "union-map":
      return undefined;
    case "js-box":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return {
        kind: "call",
        callee: { kind: "path", path: `tsonic_js.js_value_from_${conversion.source}` },
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

function convertMojoCollection(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "collection-map" }>,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (conversion.elementConversion?.kind === "identity") {
    if (conversion.source === "list" && conversion.target === "js-array") {
      registerMojoModuleImport(context, ["tsonic_js"]);
      registerMojoTypeImports(conversion.targetType, context);
      return withMojoValue(plan.before, Object.freeze({
        kind: "construct",
        type: conversion.targetType,
        arguments: Object.freeze([{ value: plan.value }]),
      }));
    }
    if (conversion.source === "js-array" && conversion.target === "list") {
      registerMojoTypeImports(conversion.targetType, context);
      return withMojoValue(plan.before, Object.freeze({
        kind: "method-call",
        receiver: plan.value,
        name: "iter_values",
        arguments: Object.freeze([]),
      }));
    }
  }
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "conversion_source");
  const resultName = allocateMojoSyntheticName(context, "conversion_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const resultListType: MojoTargetTypeRef = Object.freeze({
    kind: "list",
    element: conversion.targetElementType,
  });
  registerMojoTypeImports(resultListType, context);
  const before: MojoStatement[] = [
    ...plan.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      type: conversion.sourceType,
      initializer: plan.value,
    }),
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: resultListType,
      initializer: Object.freeze({ kind: "list", elements: Object.freeze([]) }),
    }),
  ];
  if (conversion.elementConversion !== undefined) {
    const elementName = allocateMojoSyntheticName(context, "conversion_element");
    const converted = convertMojoValue(
      mojoValue(Object.freeze({ kind: "path", path: elementName })),
      conversion.elementConversion,
      context,
    );
    if (converted === undefined) return undefined;
    before.push(Object.freeze({
      kind: "for",
      binding: elementName,
      iterable: conversion.source === "js-array"
        ? Object.freeze({
            kind: "method-call",
            receiver: source,
            name: "iter_values",
            arguments: Object.freeze([]),
          })
        : source,
      statements: Object.freeze([
        ...converted.before,
        Object.freeze({
          kind: "expression",
          expression: Object.freeze({
            kind: "method-call",
            receiver: result,
            name: "append",
            arguments: Object.freeze([{ value: converted.value }]),
          }),
        }),
      ]),
    }));
  } else {
    before.push(Object.freeze({ kind: "discard", expression: source }));
  }
  if (conversion.target === "list") return withMojoValue(before, result);
  registerMojoModuleImport(context, ["tsonic_js"]);
  return withMojoValue(before, Object.freeze({
    kind: "construct",
    type: conversion.targetType,
    arguments: Object.freeze([{ value: Object.freeze({ kind: "consume", expression: result }) }]),
  }));
}

function convertMojoOptional(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "optional-map" }>,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "optional_source");
  const resultName = allocateMojoSyntheticName(context, "optional_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const converted = convertMojoValue(mojoValue(Object.freeze({
    kind: "method-call",
    receiver: source,
    name: "value",
    arguments: Object.freeze([]),
  })), conversion.valueConversion, context);
  if (converted === undefined) return undefined;
  return withMojoValue(Object.freeze([
    ...plan.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      type: conversion.sourceType,
      initializer: plan.value,
    }),
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: conversion.targetType,
      initializer: Object.freeze({
        kind: "construct",
        type: conversion.targetType,
        arguments: Object.freeze([]),
      }),
    }),
    Object.freeze({
      kind: "if",
      condition: source,
      thenStatements: Object.freeze([
        ...converted.before,
        Object.freeze({
          kind: "assignment",
          operator: "=",
          left: result,
          right: Object.freeze({
            kind: "construct",
            type: conversion.targetType,
            arguments: Object.freeze([{ value: converted.value }]),
          }),
        }),
      ]),
    }),
  ]), result);
}

function convertMojoOptionalToUnion(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "optional-to-union" }>,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  registerMojoTypeImports(conversion.absentType, context);
  const sourceName = allocateMojoSyntheticName(context, "optional_source");
  const resultName = allocateMojoSyntheticName(context, "union_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const converted = convertMojoValue(mojoValue(Object.freeze({
    kind: "method-call",
    receiver: source,
    name: "value",
    arguments: Object.freeze([]),
  })), conversion.valueConversion, context);
  if (converted === undefined) return undefined;
  const absent: MojoExpression = Object.freeze({
    kind: "construct",
    type: conversion.targetType,
    arguments: Object.freeze([{ value: Object.freeze({
      kind: "construct",
      type: conversion.absentType,
      arguments: Object.freeze([]),
    }) }]),
  });
  return withMojoValue(Object.freeze([
    ...plan.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      type: conversion.sourceType,
      initializer: plan.value,
    }),
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: conversion.targetType,
      initializer: absent,
    }),
    Object.freeze({
      kind: "if",
      condition: source,
      thenStatements: Object.freeze([
        ...converted.before,
        Object.freeze({
          kind: "assignment",
          operator: "=",
          left: result,
          right: converted.value,
        }),
      ]),
    }),
  ]), result);
}

function convertMojoUnionToOptional(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "union-to-optional" }>,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "union_source");
  const resultName = allocateMojoSyntheticName(context, "optional_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const branches = conversion.presentMembers.map((member) => {
    registerMojoTypeImports(member.sourceType, context);
    const converted = convertMojoValue(mojoValue(Object.freeze({
      kind: "type-element",
      receiver: source,
      type: member.sourceType,
    })), member.conversion, context);
    return converted === undefined
      ? undefined
      : Object.freeze({
          kind: "if" as const,
          condition: Object.freeze({
            kind: "method-call" as const,
            receiver: source,
            name: "isa",
            genericArguments: Object.freeze([{ kind: "type" as const, type: member.sourceType }]),
            arguments: Object.freeze([]),
          }),
          thenStatements: Object.freeze([
            ...converted.before,
            Object.freeze({
              kind: "assignment" as const,
              operator: "=",
              left: result,
              right: Object.freeze({
                kind: "construct" as const,
                type: conversion.targetType,
                arguments: Object.freeze([{ value: converted.value }]),
              }),
            }),
          ]),
        });
  });
  if (branches.some((branch) => branch === undefined)) return undefined;
  return withMojoValue(Object.freeze([
    ...plan.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      type: conversion.sourceType,
      initializer: plan.value,
    }),
    Object.freeze({
      kind: "variable",
      name: resultName,
      type: conversion.targetType,
      initializer: Object.freeze({
        kind: "construct",
        type: conversion.targetType,
        arguments: Object.freeze([]),
      }),
    }),
    ...(branches as readonly MojoStatement[]),
  ]), result);
}

function convertMojoUnion(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "union-map" }>,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "union_source");
  const resultName = allocateMojoSyntheticName(context, "union_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const branches = conversion.members.map((member) => {
    registerMojoTypeImports(member.sourceType, context);
    registerMojoTypeImports(member.targetType, context);
    const converted = convertMojoValue(mojoValue(Object.freeze({
      kind: "type-element",
      receiver: source,
      type: member.sourceType,
    })), member.conversion, context);
    return converted === undefined
      ? undefined
      : Object.freeze({
          condition: Object.freeze({
            kind: "method-call" as const,
            receiver: source,
            name: "isa",
            genericArguments: Object.freeze([{ kind: "type" as const, type: member.sourceType }]),
            arguments: Object.freeze([]),
          }),
          statements: Object.freeze([
            ...converted.before,
            Object.freeze({
              kind: "assignment" as const,
              operator: "=",
              left: result,
              right: Object.freeze({
                kind: "construct" as const,
                type: conversion.targetType,
                arguments: Object.freeze([{ value: converted.value }]),
              }),
            }),
          ]),
        });
  });
  if (branches.some((branch) => branch === undefined) || branches.length === 0) return undefined;
  let selectedStatements: readonly MojoStatement[] = branches[branches.length - 1]!.statements;
  for (let index = branches.length - 2; index >= 0; index -= 1) {
    const branch = branches[index]!;
    selectedStatements = Object.freeze([Object.freeze({
      kind: "if",
      condition: branch.condition,
      thenStatements: branch.statements,
      elseStatements: selectedStatements,
    })]);
  }
  return withMojoValue(Object.freeze([
    ...plan.before,
    Object.freeze({
      kind: "variable",
      name: sourceName,
      type: conversion.sourceType,
      initializer: plan.value,
    }),
    Object.freeze({ kind: "variable", name: resultName, type: conversion.targetType }),
    ...selectedStatements,
  ]), result);
}

function convertMojoTruthiness(
  plan: MojoValuePlan,
  conversion: MojoTruthinessConversion,
  context: MojoPlanningContext,
): MojoValuePlan | undefined {
  if (conversion.kind === "always-true" || conversion.kind === "always-false") {
    return withMojoValue(Object.freeze([
      ...plan.before,
      Object.freeze({ kind: "discard" as const, expression: plan.value }),
    ]), Object.freeze({ kind: "bool-literal", value: conversion.kind === "always-true" }));
  }
  if (conversion.kind !== "optional" && conversion.kind !== "union") {
    const value = planMojoTruthiness(plan.value, conversion, context);
    return value === undefined ? undefined : withMojoValue(plan.before, value);
  }
  registerMojoTypeImports(conversion.sourceType, context);
  const name = allocateMojoSyntheticName(context, "truthiness_source");
  const source: MojoExpression = Object.freeze({ kind: "path", path: name });
  const value = planMojoTruthiness(source, conversion, context);
  return value === undefined
    ? undefined
    : withMojoValue(Object.freeze([
        ...plan.before,
        Object.freeze({
          kind: "variable" as const,
          name,
          type: conversion.sourceType,
          initializer: plan.value,
        }),
      ]), value);
}

function planMojoTruthiness(
  expression: MojoExpression,
  conversion: MojoTruthinessConversion,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  switch (conversion.kind) {
    case "always-true": return Object.freeze({ kind: "bool-literal", value: true });
    case "always-false": return Object.freeze({ kind: "bool-literal", value: false });
    case "integer": return Object.freeze({
      kind: "binary",
      operator: "!=",
      left: expression,
      right: Object.freeze({ kind: "number-literal", text: "0" }),
    });
    case "float":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: "tsonic_js.js_truthy_number" }),
        arguments: Object.freeze([{ value: expression }]),
      });
    case "string": return Object.freeze({
      kind: "binary",
      operator: "!=",
      left: Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: "len" }),
        arguments: Object.freeze([{ value: expression }]),
      }),
      right: Object.freeze({ kind: "number-literal", text: "0" }),
    });
    case "dynamic":
      registerMojoModuleImport(context, ["tsonic_js"]);
      return Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: "tsonic_js.js_truthy" }),
        arguments: Object.freeze([{ value: expression }]),
      });
    case "optional": {
      const present = planMojoTruthiness(Object.freeze({
        kind: "method-call",
        receiver: expression,
        name: "value",
        arguments: Object.freeze([]),
      }), conversion.value, context);
      return present === undefined
        ? undefined
        : Object.freeze({
            kind: "conditional",
            condition: Object.freeze({
              kind: "construct",
              type: Object.freeze({ kind: "source-primitive", name: "bool" }),
              arguments: Object.freeze([{ value: expression }]),
            }),
            whenTrue: present,
            whenFalse: Object.freeze({ kind: "bool-literal", value: false }),
          });
    }
    case "union": {
      let result: MojoExpression | undefined;
      for (let index = conversion.members.length - 1; index >= 0; index -= 1) {
        const member = conversion.members[index]!;
        registerMojoTypeImports(member.type, context);
        const selected = planMojoTruthiness(Object.freeze({
          kind: "type-element",
          receiver: expression,
          type: member.type,
        }), member.conversion, context);
        if (selected === undefined) return undefined;
        result = result === undefined
          ? selected
          : Object.freeze({
              kind: "conditional",
              condition: Object.freeze({
                kind: "method-call",
                receiver: expression,
                name: "isa",
                genericArguments: Object.freeze([{ kind: "type" as const, type: member.type }]),
                arguments: Object.freeze([]),
              }),
              whenTrue: selected,
              whenFalse: result,
            });
      }
      return result;
    }
  }
}

export function isJsString(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsString";
}

export function isJsArray(type: MojoTargetTypeRef): boolean {
  return type.kind === "target-named" && type.id === "tsonic.mojo.js.JsArray";
}

export function jsArrayElement(type: MojoTargetTypeRef): MojoTargetTypeRef | undefined {
  if (!isJsArray(type) || type.kind !== "target-named") return undefined;
  const argument = type.genericArguments?.[0];
  return argument?.kind === "type" ? argument.type : undefined;
}

export function requiredMojoTypeName(
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): string {
  const name = mojoTypeName(type, context.module.modulePath);
  if (name === undefined) throw new Error("A Mojo unit type cannot own a static method.");
  return name;
}
