import type { Node } from "@tsonic/tsts";
import type {
  MojoProjectObjectLiteralDispatch,
  MojoProjectObjectLiteralFieldAdapter,
  MojoProjectObjectLiteralMethodStorage,
} from "../../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../../target-model/types/equality.js";
import type { MojoExpression, MojoStatement } from "../../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import type { MojoValuePlanner } from "../../expressions/support.js";
import { isTriviallyPureMojoValue } from "../../expressions/support.js";
import type { MojoValuePlan } from "../../expressions/value-plan.js";
import { withMojoValue } from "../../expressions/value-plan.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import { planDictionaryKey } from "../../expressions/conditional-values.js";

export function objectStateFields(dispatch: MojoProjectObjectLiteralDispatch): {
  readonly stored: readonly Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>[];
  readonly methods: readonly MojoProjectObjectLiteralMethodStorage[];
  readonly indexes: readonly {
    readonly declaration: Node;
    readonly name: string;
    readonly type: MojoTargetTypeRef;
  }[];
} {
  const stored = uniqueStoredAdapters(dispatch);
  const indexes = dispatch.selection.indexSignatures.map(({ indexSignature, keyType, valueType }) =>
    Object.freeze({
      declaration: indexSignature.declaration,
      name: indexSignature.storageName,
      type: Object.freeze({ kind: "dictionary" as const, key: keyType, value: valueType }),
    }));
  return Object.freeze({
    stored,
    methods: dispatch.methodStorages,
    indexes: Object.freeze(indexes),
  });
}

export function uniqueStoredAdapters(
  dispatch: MojoProjectObjectLiteralDispatch,
): readonly Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>[] {
  const byName = new Map<string, Extract<MojoProjectObjectLiteralFieldAdapter, { readonly kind: "stored" }>>();
  for (const view of dispatch.views) {
    for (const adapter of view.fieldAdapters) {
      if (adapter.kind === "stored" && !byName.has(adapter.stateName)) {
        byName.set(adapter.stateName, adapter);
      }
    }
  }
  return Object.freeze([...byName.values()]);
}

export function propertyDeclarations(
  property: import("../../../../analysis/program/model.js").MojoProjectDispatchField["property"],
): readonly Node[] {
  return property.kind === "accessor-property" ? property.declarations : [property.declaration];
}

export function planIndexKey(
  key: Extract<import("../../../../analysis/program/model.js").MojoObjectLiteralContribution, {
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

export function stabilize(
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

export function localNamedType(context: MojoPlanningContext, name: string): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: `tsonic.mojo.generated.${context.module.modulePath.join(".")}.${name}`,
    modulePath: context.module.modulePath,
    name,
  });
}

export function allocateLocalName(names: Set<string>, requested: string): string {
  let candidate = requested;
  let suffix = 2;
  while (names.has(candidate)) candidate = `${requested}_${suffix++}`;
  names.add(candidate);
  return candidate;
}

export function sameTargetType(left: MojoTargetTypeRef, right: MojoTargetTypeRef): boolean {
  return mojoTargetTypeEquals(left, right);
}


