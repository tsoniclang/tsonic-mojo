import type { MojoValueConversion } from "../../../target-model/conversions/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { allocateMojoSyntheticName } from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { mojoProjectStateValue } from "../declarations/state-storage.js";
import { mojoNativeErrorType } from "../../../target-model/types/error-domains.js";
import { adaptMojoValueErrorDomain } from "./error-domains.js";
import type { MojoNestedValueConverter } from "./conversion-support.js";
import { consumeMojoValue, mojoValue, retainMojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function convertMojoProviderRecord(
  plan: MojoValuePlan,
  conversion: Extract<MojoValueConversion, { readonly kind: "provider-record" }>,
  context: MojoPlanningContext,
  convert: MojoNestedValueConverter,
): MojoValuePlan | undefined {
  registerMojoTypeImports(conversion.sourceType, context);
  registerMojoTypeImports(conversion.targetType, context);
  const sourceName = allocateMojoSyntheticName(context, "record_source");
  const resultName = allocateMojoSyntheticName(context, "record_snapshot");
  const source: MojoExpression = Object.freeze({ kind: "path", path: sourceName });
  const result: MojoExpression = Object.freeze({ kind: "path", path: resultName });
  const before: MojoStatement[] = [...plan.before,
    Object.freeze({ kind: "variable", name: sourceName, type: conversion.sourceType,
      initializer: retainMojoValue(plan.value, conversion.sourceType, context.program.lifecycle) }),
    Object.freeze({ kind: "variable", name: resultName, type: conversion.targetType,
      initializer: Object.freeze({ kind: "construct", type: conversion.targetType, arguments: Object.freeze([]) }) }),
  ];
  for (const field of conversion.fields) {
    let value: MojoValuePlan;
    if (field.read.kind === "structural") {
      value = mojoValue(Object.freeze({ kind: "element",
        receiver: Object.freeze({ kind: "postfix-deref", expression: Object.freeze({ kind: "member", receiver: source, name: "_state" }) }),
        index: Object.freeze({ kind: "number-literal", text: String(field.read.index) }),
      }));
    } else if (field.read.kind === "accessor") {
      const implementation = context.program.queries.callableImplementation(field.read.declaration);
      if (implementation === undefined) throw new Error("Sealed provider record accessor lost its implementation.");
      const selected = adaptMojoValueErrorDomain(mojoValue(Object.freeze({ kind: "method-call", receiver: source,
        name: field.read.name, arguments: Object.freeze([]) })), field.sourceType,
        implementation.raises ? implementation.errorType ?? mojoNativeErrorType() : undefined,
        context.errorType, field.read.declaration, context);
      if (selected === undefined) return undefined;
      value = selected;
    } else {
      const dispatch = context.program.projectDispatch.viewForType(conversion.sourceType);
      if (dispatch !== undefined) {
        const route = context.program.projectDispatch.fieldFor(conversion.sourceType, field.read.declaration);
        if (route?.read === undefined) throw new Error("Sealed provider record field lost its dispatch route.");
        value = mojoValue(Object.freeze({ kind: "method-call", receiver: source, name: route.read.name, arguments: Object.freeze([]) }));
      } else {
        const state = mojoProjectStateValue(source, conversion.sourceType, context);
        if (state === undefined) throw new Error("Sealed provider record field lost its state projection.");
        value = mojoValue(Object.freeze({ kind: "member", receiver: state, name: field.read.name }));
      }
    }
    const converted = convert(value, field.conversion, context);
    if (converted === undefined) return undefined;
    before.push(...converted.before, Object.freeze({ kind: "assignment", operator: "=",
      left: Object.freeze({ kind: "member", receiver: result, name: field.targetName }),
      right: retainMojoValue(converted.value, field.targetType, context.program.lifecycle),
    }));
  }
  return withMojoValue(before, consumeMojoValue(result, conversion.targetType, context.program.lifecycle));
}
