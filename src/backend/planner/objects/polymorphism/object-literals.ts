import type { Node } from "@tsonic/tsts";
import type {
  MojoProjectObjectLiteralDispatch,
} from "../../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../../../target-model/types/equality.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoStatement,
} from "../../../target-ast/index.js";
import {
  allocateMojoSyntheticDeclarationName,
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import type { MojoValuePlanner } from "../../expressions/support.js";
import {
  applyMojoConversion,
  orderMojoValues,
} from "../../expressions/support.js";
import type { MojoValuePlan } from "../../expressions/value-plan.js";
import { consumeMojoValue, withMojoValue } from "../../expressions/value-plan.js";
import { registerMojoTypeImports } from "../../types/imports.js";
import {
  mojoProjectObjectType,
  mojoProjectStaticMember,
} from "./types.js";
import { planObjectStateDeclarations } from "./object-literal-declarations.js";
import {
  localNamedType,
  objectStateFields,
  planIndexKey,
  propertyDeclarations,
  sameTargetType,
  stabilize,
  uniqueStoredAdapters,
} from "./object-literal-support.js";

export function planMojoPolymorphicObjectLiteral(
  node: Node,
  dispatch: MojoProjectObjectLiteralDispatch,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const stateName = allocateMojoSyntheticDeclarationName(context, "object_state");
  const stateType = localNamedType(context, stateName);
  const storedAdapters = uniqueStoredAdapters(dispatch);
  const indexStorage = new Map<Node, { readonly name: string; readonly type: MojoTargetTypeRef }>();
  const before: MojoStatement[] = [];
  const storedValues = new Map<string, MojoExpression>();
  const storedMethods = new Map<string, MojoExpression>();

  for (const { indexSignature, keyType, valueType } of dispatch.selection.indexSignatures) {
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

  for (const contribution of dispatch.selection.contributions) {
    if (contribution.kind === "method" || contribution.kind === "getter" ||
      contribution.kind === "setter") continue;
    if (contribution.kind === "field") {
      const targets = storedAdapters.filter((adapter) =>
        propertyDeclarations(adapter.field.property).some((declaration) =>
          propertyDeclarations(contribution.field).includes(declaration)));
      const plan = planValue(contribution.value, context, contribution.fieldType);
      if (targets.length === 0 || plan === undefined) return undefined;
      before.push(...plan.before);
      const value = stabilize(
        plan.value,
        contribution.fieldType,
        "object_field",
        before,
        context,
      );
      for (const target of targets) storedValues.set(target.stateName, value);
      continue;
    }
    if (contribution.kind === "index-entry") {
      const storage = indexStorage.get(contribution.indexSignature.declaration);
      const key = planIndexKey(contribution.key, contribution.keyType, context, planValue);
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
    const spreadPlan = planValue(contribution.value, context, contribution.sourceType);
    if (spreadPlan === undefined) return undefined;
    before.push(...spreadPlan.before);
    const spread = stabilize(
      spreadPlan.value,
      contribution.sourceType,
      "object_spread",
      before,
      context,
    );
    const sourceView = dispatch.views.find((candidate) =>
      sameTargetType(candidate.viewType, contribution.sourceType));
    if (sourceView === undefined) return undefined;
    for (const adapter of storedAdapters) {
      const sourceField = sourceView.fieldAdapters.find((candidate) =>
        propertyDeclarations(candidate.field.property).some((declaration) =>
          propertyDeclarations(adapter.field.property).includes(declaration)));
      const readName = sourceField?.field.read?.name;
      if (readName === undefined) return undefined;
      const value: MojoExpression = Object.freeze({
        kind: "method-call",
        receiver: spread,
        name: readName,
        arguments: Object.freeze([]),
      });
      storedValues.set(
        adapter.stateName,
        stabilize(value, adapter.storageType, "spread_field", before, context),
      );
    }
    for (const storage of dispatch.methodStorages) {
      if (storage.initialization.kind !== "spread" ||
        storage.initialization.contribution !== contribution) continue;
      const variant = context.program.projectDispatch.callableFor(
        contribution.sourceType,
        storage.initialization.declaration,
        Object.freeze([]),
      );
      if (variant?.property?.read === undefined ||
        !mojoTargetTypeEquals(variant.property.callableType, storage.callableType)) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_OBJECT_SPREAD_METHOD_READ_NOT_SEALED",
          "Object spread has no exact bound-callable read slot for one selected project method.",
          contribution.element,
        );
        return undefined;
      }
      const optionalType = storage.storageType;
      registerMojoTypeImports(optionalType, context);
      storedMethods.set(storage.name, Object.freeze({
        kind: "construct",
        type: optionalType,
        arguments: Object.freeze([Object.freeze({
          value: Object.freeze({
            kind: "method-call",
            receiver: spread,
            name: variant.property.read.name,
            arguments: Object.freeze([]),
          }),
        })]),
      }));
    }
    for (const entry of contribution.indexSignatures) {
      const destination = indexStorage.get(entry.indexSignature.declaration);
      const sourceIndex = sourceView.indexAdapters.find((candidate) =>
        candidate.index.indexSignature.declaration === entry.indexSignature.declaration);
      if (destination === undefined || sourceIndex === undefined ||
        !mojoTargetTypeEquals(destination.type, sourceIndex.storageType)) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_POLYMORPHIC_INDEX_SPREAD_NOT_SEALED",
          "A polymorphic object spread has no exact index-signature copy dispatch plan.",
          contribution.element,
        );
        return undefined;
      }
      before.push(Object.freeze({
        kind: "expression",
        expression: Object.freeze({
          kind: "method-call",
          receiver: spread,
          name: sourceIndex.index.copy.name,
          arguments: Object.freeze([Object.freeze({
            value: Object.freeze({ kind: "path", path: destination.name }),
          })]),
        }),
      }));
    }
  }

  for (const adapter of storedAdapters) {
    if (storedValues.has(adapter.stateName)) continue;
    const field = dispatch.selection.fields.find(({ field }) =>
      propertyDeclarations(adapter.field.property).includes(field.declaration));
    if (field?.field.optional !== true) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_OBJECT_REQUIRED_FIELD_PLAN_MISSING",
        "Polymorphic object construction has no sealed value for one required field.",
        node,
      );
      return undefined;
    }
    registerMojoTypeImports(adapter.storageType, context);
    storedValues.set(adapter.stateName, Object.freeze({
      kind: "construct",
      type: adapter.storageType,
      arguments: Object.freeze([]),
    }));
  }
  for (const storage of dispatch.methodStorages) {
    if (storedMethods.has(storage.name)) continue;
    if (storage.initialization.kind !== "default") return undefined;
    registerMojoTypeImports(storage.storageType, context);
    storedMethods.set(storage.name, Object.freeze({ kind: "none-literal" }));
  }

  const declarations = planObjectStateDeclarations(dispatch, stateName, stateType, context);
  if (declarations === undefined) return undefined;
  context.syntheticDeclarations.push(declarations);
  registerMojoTypeImports(mojoProjectObjectType, context);
  const stateFields = objectStateFields(dispatch);
  const stateArguments: MojoCallArgument[] = [];
  for (const field of stateFields.stored) {
    const value = storedValues.get(field.stateName);
    if (value === undefined) return undefined;
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(value, field.storageType, context.program.lifecycle),
    }));
  }
  for (const storage of stateFields.methods) {
    const value = storedMethods.get(storage.name);
    if (value === undefined) return undefined;
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(
        value,
        storage.storageType,
        context.program.lifecycle,
      ),
    }));
  }
  for (const entry of stateFields.indexes) {
    const storage = indexStorage.get(entry.declaration);
    if (storage === undefined) return undefined;
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(
        Object.freeze({ kind: "path", path: storage.name }),
        storage.type,
        context.program.lifecycle,
      ),
    }));
  }
  for (const capture of dispatch.captures) {
    stateArguments.push(Object.freeze({
      value: consumeMojoValue(
        Object.freeze({ kind: "path", path: capture.capture.name }),
        capture.storageType,
        context.program.lifecycle,
      ),
    }));
  }
  const object: MojoExpression = Object.freeze({
    kind: "construct",
    type: mojoProjectObjectType,
    arguments: Object.freeze([Object.freeze({
      value: Object.freeze({
        kind: "construct",
        type: stateType,
        arguments: Object.freeze(stateArguments),
      }),
    })]),
  });
  const root = dispatch.views.find((view) =>
    sameTargetType(view.viewType, dispatch.selection.constructionType));
  if (root === undefined) return undefined;
  const constructed: MojoExpression = Object.freeze({
    kind: "call",
    callee: mojoProjectStaticMember(stateType, root.factoryName),
    arguments: Object.freeze([Object.freeze({ value: object })]),
  });
  const converted = applyMojoConversion(
    constructed,
    dispatch.selection.resultConversion,
    context,
  );
  return converted === undefined ? undefined : withMojoValue(before, converted);
}
