import type { Node } from "@tsonic/tsts";
import type { MojoTypedLocationSelection } from "../../../target-model/operations/typed-locations.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement, MojoFunctionDeclaration } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { allocateMojoSyntheticName, appendMojoPlanningDiagnostic, mojoModuleMemberExpression } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoProperty } from "./properties.js";
import { planMojoProjectPropertyWrite, projectPropertyUsesMethodWrite } from "./property-writes.js";
import { planMojoLocationOwnerIdentity } from "./location-identity.js";
import { orderMojoLocationValues } from "./location-values.js";
import type { MojoValuePlanner } from "./support.js";
import { consumeMojoValue, mojoValue, withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";

export function planMojoAddressedLocation(
  selection: Extract<MojoTypedLocationSelection, { readonly operation: "address-of" }>,
  node: Node,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): MojoValuePlan | undefined {
  const storage = selection.storage;
  if (storage.kind === "local") {
    const local = context.program.queries.locationStorage(storage.declaration);
    if (local === undefined) {
      appendMojoPlanningDiagnostic(context, "MOJO_POINTER_STORAGE_PLAN_MISSING", "Address-of has no sealed promoted Mojo storage.", node);
      return undefined;
    }
    return mojoValue(Object.freeze({ kind: "construct", type: selection.locationType, arguments: Object.freeze([{ value: path(local.name) }]) }));
  }
  const receiver = planValue(storage.receiver, context, storage.receiverType);
  if (receiver === undefined) return undefined;
  if (storage.kind === "element" || storage.kind === "native-element") {
    const index = planValue(storage.index, context, storage.indexType);
    if (index === undefined) return undefined;
    const ordered = orderMojoLocationValues([
      { plan: receiver, type: storage.receiverType, role: "location_owner" },
      { plan: index, type: storage.indexType, role: "location_index" },
    ], context);
    if (storage.kind === "native-element") {
      return withMojoValue(ordered.before, Object.freeze({ kind: "method-call", receiver: ordered.values[0]!,
        name: "location", arguments: Object.freeze([{ value: ordered.values[1]! }]) }));
    }
    return withMojoValue(ordered.before, Object.freeze({ kind: "call",
      callee: mojoModuleMemberExpression(context, ["tsonic_js"], "array_location"),
      genericArguments: Object.freeze([Object.freeze({ kind: "type", type: selection.pointeeType })]),
      arguments: Object.freeze(ordered.values.map((value) => Object.freeze({ value }))),
    }));
  }
  const ownerName = allocateMojoSyntheticName(context, "location_owner");
  const owner = path(ownerName);
  const keyType: MojoTargetTypeRef = Object.freeze({ kind: "native-string" });
  const key: MojoExpression = Object.freeze({ kind: "string-literal", value: storage.key });
  const rootIdentity = planMojoLocationOwnerIdentity(owner, storage.receiverType, storage.identity, context);
  if (rootIdentity === undefined) return undefined;
  const identity: MojoExpression = Object.freeze({ kind: "method-call", receiver: rootIdentity, name: "member", arguments: Object.freeze([{ value: key }]) });
  const readName = allocateMojoSyntheticName(context, "location_read");
  const writeName = allocateMojoSyntheticName(context, "location_write");
  const receiverName = allocateMojoSyntheticName(context, "owner");
  const keyName = allocateMojoSyntheticName(context, "_key");
  const valueName = allocateMojoSyntheticName(context, "value");
  const preparedValue: MojoValuePlanner = (expression, innerContext, expected) => expression === storage.receiver
    ? mojoValue(path(receiverName)) : planValue(expression, innerContext, expected);
  const read = planMojoProperty(storage.expression, context, preparedValue, "read");
  if (read === undefined) return undefined;
  const writeValue = consumeMojoValue(path(valueName), selection.pointeeType, context.program.lifecycle);
  let write: readonly MojoStatement[];
  if (projectPropertyUsesMethodWrite(context.program.queries.propertySelection(storage.expression), context)) {
    const prepared = planMojoProjectPropertyWrite(storage.expression, mojoValue(writeValue), "=", context, preparedValue, node);
    if (prepared === undefined) return undefined;
    write = [...prepared.before, prepared.createWrite(prepared.assignedValue)];
  } else {
    const target = planMojoProperty(storage.expression, context, preparedValue, "write");
    if (target === undefined) return undefined;
    write = [...target.before, Object.freeze({ kind: "assignment", left: target.value, operator: "=", right: writeValue })];
  }
  const helper = (name: string, writing: boolean, statements: readonly MojoStatement[]): MojoStatement => {
    const declaration: MojoFunctionDeclaration = Object.freeze({
      kind: "function", name, genericParameters: Object.freeze([]), asynchronous: false, raises: true,
      resultType: writing ? Object.freeze({ kind: "unit" }) : selection.pointeeType,
      parameters: Object.freeze([
        Object.freeze({ name: receiverName, type: storage.receiverType, convention: writing ? "mut" as const : "imm" as const }),
        Object.freeze({ name: keyName, type: keyType }),
        ...(writing ? [Object.freeze({ name: valueName, type: selection.pointeeType, convention: "var" as const })] : []),
      ]), statements: Object.freeze(statements),
    });
    return Object.freeze({ kind: "local-function", declaration });
  };
  for (const type of [storage.receiverType, keyType, selection.pointeeType]) registerMojoTypeImports(type, context);
  return withMojoValue([
    ...receiver.before,
    Object.freeze({ kind: "variable", name: ownerName, type: storage.receiverType, initializer: receiver.value }),
    helper(readName, false, [...read.before, Object.freeze({ kind: "return", expression: read.value })]),
    helper(writeName, true, write),
  ], Object.freeze({ kind: "call", callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "access_location"),
    genericArguments: Object.freeze([storage.receiverType, keyType, selection.pointeeType].map((type) => Object.freeze({ kind: "type" as const, type }))),
    arguments: Object.freeze([owner, key, identity, path(readName), path(writeName)].map((value) => Object.freeze({ value }))),
  }));
}

function path(name: string): MojoExpression {
  return Object.freeze({ kind: "path", path: name });
}
