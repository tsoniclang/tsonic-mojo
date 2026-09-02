import type {
  MojoTruthinessConversion,
  MojoValueConversion,
} from "../../../target-model/conversions/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/render.js";
import { mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export type MojoNestedValueConverter = (
  plan: MojoValuePlan,
  conversion: MojoValueConversion,
  context: MojoPlanningContext,
) => MojoValuePlan | undefined;

export function convertMojoCollection(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "collection-map" }>,
  context: MojoPlanningContext,
  convertNested: MojoNestedValueConverter,
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
    const converted = convertNested(
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

export function convertMojoOptional(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "optional-map" }>,
  context: MojoPlanningContext,
  convertNested: MojoNestedValueConverter,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "optional_source");
  const resultName = allocateMojoSyntheticName(context, "optional_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const converted = convertNested(mojoValue(Object.freeze({
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

export function convertMojoOptionalToUnion(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "optional-to-union" }>,
  context: MojoPlanningContext,
  convertNested: MojoNestedValueConverter,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  registerMojoTypeImports(conversion.absentType, context);
  const sourceName = allocateMojoSyntheticName(context, "optional_source");
  const resultName = allocateMojoSyntheticName(context, "union_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const converted = convertNested(mojoValue(Object.freeze({
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

export function convertMojoUnionToOptional(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "union-to-optional" }>,
  context: MojoPlanningContext,
  convertNested: MojoNestedValueConverter,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "union_source");
  const resultName = allocateMojoSyntheticName(context, "optional_result");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const branches = conversion.presentMembers.map((member) => {
    registerMojoTypeImports(member.sourceType, context);
    const converted = convertNested(mojoValue(Object.freeze({
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

export function convertMojoUnion(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "union-map" }>,
  context: MojoPlanningContext,
  convertNested: MojoNestedValueConverter,
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
    const converted = convertNested(mojoValue(Object.freeze({
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

export function convertMojoTruthiness(
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

export function planMojoTruthiness(
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
