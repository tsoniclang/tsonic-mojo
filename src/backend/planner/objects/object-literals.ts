import type { Node } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { isTriviallyPureMojoValue, orderMojoValues } from "../expressions/support.js";
import type { MojoValuePlanner } from "../expressions/support.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { applyMojoConversion } from "../expressions/support.js";
import { withMojoValue } from "../expressions/value-plan.js";
import type { MojoValuePlan } from "../expressions/value-plan.js";
import { planDictionaryKey } from "../expressions/conditional-values.js";
import { planMojoPolymorphicObjectLiteral } from "./polymorphism/object-literals.js";
import { mojoProjectStateValue } from "../declarations/state-storage.js";

export function planMojoProjectObjectLiteral(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.objectLiteralSelection(node);
  if (selection?.kind !== "interface") return undefined;
  const dispatch = context.program.projectDispatch.objectLiteralFor(node);
  if (dispatch !== undefined) {
    return planMojoPolymorphicObjectLiteral(node, dispatch, context, planValue);
  }
  registerMojoTypeImports(selection.constructionType, context);
  registerMojoTypeImports(selection.resultType, context);
  const before: MojoStatement[] = [];
  const values = new Map<Node, MojoExpression>();
  const indexStorage = new Map<Node, {
    readonly name: string;
    readonly type: MojoTargetTypeRef;
  }>();
  for (const { indexSignature, keyType, valueType } of selection.indexSignatures) {
    const type: MojoTargetTypeRef = Object.freeze({ kind: "dictionary", key: keyType, value: valueType });
    const name = allocateMojoSyntheticName(context, "object_index");
    registerMojoTypeImports(type, context);
    before.push(Object.freeze({
      kind: "variable",
      name,
      type,
      initializer: Object.freeze({ kind: "dictionary", entries: Object.freeze([]) }),
    }));
    indexStorage.set(indexSignature.declaration, Object.freeze({ name, type }));
  }
  for (const contribution of selection.contributions) {
    if (contribution.kind === "field") {
      if (contribution.field.kind !== "interface-field") return undefined;
      const plan = planValue(contribution.value, context, contribution.fieldType);
      if (plan === undefined) return undefined;
      before.push(...plan.before);
      values.set(
        contribution.field.declaration,
        stabilize(plan.value, contribution.fieldType, "object_field", before, context),
      );
      continue;
    }
    if (contribution.kind === "index-entry") {
      const storage = indexStorage.get(contribution.indexSignature.declaration);
      const key = planProjectIndexKey(contribution.key, contribution.keyType, context, planValue);
      const value = planValue(contribution.value, context, contribution.valueType);
      if (storage === undefined || key === undefined || value === undefined) return undefined;
      const ordered = orderMojoValues(Object.freeze([
        Object.freeze({ plan: key, type: contribution.keyType, role: "object_index_key" }),
        Object.freeze({ plan: value, type: contribution.valueType, role: "object_index_value" }),
      ]), context, true);
      before.push(...ordered.before, Object.freeze({
        kind: "assignment",
        operator: "=",
        left: Object.freeze({
          kind: "element",
          receiver: Object.freeze({ kind: "path", path: storage.name }),
          index: ordered.values[0]!,
        }),
        right: ordered.values[1]!,
      }));
      continue;
    }
    if (contribution.kind === "method" || contribution.kind === "getter" ||
      contribution.kind === "setter") return undefined;
    const plan = planValue(contribution.value, context, contribution.sourceType);
    if (plan === undefined) return undefined;
    before.push(...plan.before);
    const spread = stabilize(plan.value, contribution.sourceType, "object_spread", before, context);
    const spreadState = mojoProjectStateValue(spread, contribution.sourceType, context);
    if (spreadState === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_OBJECT_SPREAD_STATE_NOT_SEALED",
        "A project object spread has no exact sealed state projection.",
        contribution.element,
      );
      return undefined;
    }
    for (const entry of contribution.fields) {
      const value: MojoExpression = Object.freeze({
        kind: "member",
        receiver: spreadState,
        name: entry.field.name,
      });
      values.set(
        entry.field.declaration,
        stabilize(value, entry.fieldType, "spread_field", before, context),
      );
    }
    for (const entry of contribution.indexSignatures) {
      const destination = indexStorage.get(entry.indexSignature.declaration);
      if (destination === undefined) return undefined;
      const sourceDictionary: MojoExpression = Object.freeze({
        kind: "member",
        receiver: spreadState,
        name: entry.indexSignature.storageName,
      });
      const keyName = allocateMojoSyntheticName(context, "object_index_key");
      const key: MojoExpression = Object.freeze({ kind: "path", path: keyName });
      before.push(Object.freeze({
        kind: "for",
        binding: keyName,
        iterable: Object.freeze({
          kind: "method-call",
          receiver: sourceDictionary,
          name: "keys",
          arguments: Object.freeze([]),
        }),
        statements: Object.freeze([Object.freeze({
          kind: "assignment",
          operator: "=",
          left: Object.freeze({
            kind: "element",
            receiver: Object.freeze({ kind: "path", path: destination.name }),
            index: key,
          }),
          right: Object.freeze({ kind: "element", receiver: sourceDictionary, index: key }),
        })]),
      }));
    }
  }
  const arguments_ = selection.fields.map(({ field, fieldType }) => {
    const value = values.get(field.declaration);
    if (value !== undefined) return Object.freeze({ value });
    if (!field.optional) return undefined;
    registerMojoTypeImports(fieldType, context);
    return Object.freeze({
      value: Object.freeze({
        kind: "construct" as const,
        type: fieldType,
        arguments: Object.freeze([]),
      }),
    });
  });
  if (arguments_.some((argument) => argument === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OBJECT_REQUIRED_FIELD_PLAN_MISSING",
      "Project object construction has no sealed value for one required interface field.",
      node,
    );
    return undefined;
  }
  const indexArguments = selection.indexSignatures.map(({ indexSignature }) => {
    const storage = indexStorage.get(indexSignature.declaration);
    return storage === undefined
      ? undefined
      : Object.freeze({ value: Object.freeze({ kind: "path" as const, path: storage.name }) });
  });
  if (indexArguments.some((argument) => argument === undefined)) {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_OBJECT_INDEX_STORAGE_PLAN_MISSING",
      "Project object construction has no sealed storage for one selected index signature.",
      node,
    );
    return undefined;
  }
  const constructed = Object.freeze({
    kind: "construct",
    type: selection.constructionType,
    arguments: Object.freeze([
      ...(arguments_ as { readonly value: MojoExpression }[]),
      ...(indexArguments as { readonly value: MojoExpression }[]),
    ]),
  }) satisfies MojoExpression;
  const converted = applyMojoConversion(constructed, selection.resultConversion, context);
  return converted === undefined ? undefined : withMojoValue(before, converted);
}

function planProjectIndexKey(
  key: Extract<import("../../../analysis/program/model.js").MojoObjectLiteralContribution, {
    readonly kind: "index-entry";
  }>["key"],
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  if (key.kind === "expression") return planValue(key.expression, context, type);
  const value = key.literalKind === "string"
    ? planDictionaryKey(key.value, type, context)
    : Object.freeze({ kind: "number-literal" as const, text: key.value });
  return value === undefined ? undefined : withMojoValue(Object.freeze([]), value);
}

export function planMojoProviderRecordLiteral(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.objectLiteralSelection(node);
  if (selection?.kind !== "provider-record") return undefined;
  registerMojoTypeImports(selection.targetType, context);
  const plans = selection.fields.map((field) => ({
    plan: planValue(field.value, context, field.storageType),
    field,
  }));
  if (plans.some(({ plan }) => plan === undefined)) return undefined;
  const ordered = orderMojoValues(
    plans.map(({ plan, field }) => Object.freeze({
      plan: plan!,
      type: field.storageType,
      role: "provider_record_field",
    })),
    context,
  );
  return withMojoValue(ordered.before, Object.freeze({
    kind: "construct",
    type: selection.targetType,
    arguments: Object.freeze(selection.fields.map((field, index) => Object.freeze({
      name: field.targetName,
      value: ordered.values[index]!,
    }))),
  }));
}

export function planMojoStructuralObjectLiteral(
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const selection = context.program.queries.objectLiteralSelection(node);
  if (selection?.kind !== "structural") return undefined;
  registerMojoTypeImports(selection.definition.type, context);
  const plans = selection.fields.map((field) => Object.freeze({
    field,
    plan: planValue(field.value, context, field.field.type),
  }));
  if (plans.some(({ plan }) => plan === undefined)) return undefined;
  const ordered = orderMojoValues(plans.map(({ field, plan }) => Object.freeze({
    plan: plan!,
    type: field.field.type,
    role: "structural_object_field",
  })), context);
  const storage: MojoExpression = Object.freeze({
    kind: "tuple",
    elements: Object.freeze(ordered.values),
  });
  return withMojoValue(ordered.before, Object.freeze({
    kind: "construct",
    type: selection.definition.type,
    arguments: Object.freeze([Object.freeze({ value: storage })]),
  }));
}

function stabilize(
  value: MojoExpression,
  type: MojoTargetTypeRef,
  role: string,
  before: MojoStatement[],
  context: MojoPlanningContext,
): MojoExpression {
  registerMojoTypeImports(type, context);
  if (isTriviallyPureMojoValue(value)) return value;
  const name = allocateMojoSyntheticName(context, role);
  before.push(Object.freeze({ kind: "variable", name, type, initializer: value }));
  return Object.freeze({ kind: "path", path: name });
}
