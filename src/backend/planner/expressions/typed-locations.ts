import type { Node } from "@tsonic/tsts";
import type { MojoTypedLocationSelection } from "../../../target-model/operations/typed-locations.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import { mojoTypedLocationPointee } from "../../../target-model/types/typed-locations.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoModuleMemberExpression } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { orderMojoLocationValues } from "./location-values.js";
import type { MojoValuePlanner } from "./support.js";
import { withMojoValue } from "./value-plan.js";
import type { MojoValuePlan } from "./value-plan.js";
import { planMojoAddressedLocation } from "./addressed-locations.js";
import { planMojoLocationOwnerIdentity } from "./location-identity.js";

export function planMojoTypedLocation(selection: MojoTypedLocationSelection, node: Node, context: MojoPlanningContext, planValue: MojoValuePlanner): MojoValuePlan | undefined {
  registerMojoTypeImports(selection.locationType, context);
  const runtimeCall = (name: string, values: readonly MojoExpression[], types: readonly MojoTargetTypeRef[] = []): MojoExpression => Object.freeze({
    kind: "call", callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], name),
    ...(types.length === 0 ? {} : { genericArguments: Object.freeze(types.map((type) => Object.freeze({ kind: "type" as const, type }))) }),
    arguments: Object.freeze(values.map((value) => Object.freeze({ value }))),
  });
  switch (selection.operation) {
    case "address-of": return planMojoAddressedLocation(selection, node, context, planValue);
    case "allocate": {
      const initial = planValue(selection.initialExpression, context, selection.pointeeType);
      return initial === undefined ? undefined : withMojoValue(initial.before, construct(selection.locationType, [initial.value]));
    }
    case "load": {
      const pointer = planValue(selection.pointerExpression, context, selection.locationType);
      return pointer === undefined ? undefined : withMojoValue(pointer.before, method(pointer.value, "read"));
    }
    case "store": {
      const pointer = planValue(selection.pointerExpression, context, selection.locationType);
      const value = planValue(selection.valueExpression, context, selection.pointeeType);
      if (pointer === undefined || value === undefined) return undefined;
      const ordered = orderMojoLocationValues([{ plan: pointer, type: selection.locationType, role: "location" }, { plan: value, type: selection.pointeeType, role: "value" }], context);
      return withMojoValue(ordered.before, method(ordered.values[0]!, "write", [ordered.values[1]!]));
    }
    case "equal-pointer": {
      const left = planValue(selection.leftExpression, context, selection.operandType);
      const right = planValue(selection.rightExpression, context, selection.operandType);
      if (left === undefined || right === undefined) return undefined;
      const ordered = orderMojoLocationValues([{ plan: left, type: selection.operandType, role: "left" }, { plan: right, type: selection.operandType, role: "right" }], context);
      return withMojoValue(ordered.before, runtimeCall("equal_typed_location", ordered.values, [selection.pointeeType]));
    }
    case "hash-pointer": {
      const pointer = planValue(selection.pointerExpression, context, selection.operandType);
      return pointer === undefined ? undefined : withMojoValue(pointer.before, runtimeCall("hash_typed_location", [pointer.value], [selection.pointeeType]));
    }
    case "bind-pointer": {
      const owner = planValue(selection.identityExpression, context, selection.identityType);
      const read = planValue(selection.readExpression, context, selection.readType);
      const write = planValue(selection.writeExpression, context, selection.writeType);
      if (owner === undefined || read === undefined || write === undefined) return undefined;
      const ordered = orderMojoLocationValues([{ plan: owner, type: selection.identityType, role: "owner" }, { plan: read, type: selection.readType, role: "read" }, { plan: write, type: selection.writeType, role: "write" }], context);
      const identity = planMojoLocationOwnerIdentity(ordered.values[0]!, selection.identityType, selection.identity, context);
      if (identity === undefined) return undefined;
      return withMojoValue(ordered.before, runtimeCall("bind_location", [ordered.values[0]!, identity, ordered.values[1]!, ordered.values[2]!], [selection.identityType, selection.pointeeType]));
    }
    case "project-pointer": {
      const pointer = planValue(selection.pointerExpression, context, selection.sourceLocationType);
      const from = planValue(selection.fromSourceExpression, context, selection.fromSourceType);
      const to = planValue(selection.toSourceExpression, context, selection.toSourceType);
      const sourcePointee = mojoTypedLocationPointee(selection.sourceLocationType);
      if (pointer === undefined || from === undefined || to === undefined || sourcePointee === undefined) return undefined;
      const ordered = orderMojoLocationValues([{ plan: pointer, type: selection.sourceLocationType, role: "location" }, { plan: from, type: selection.fromSourceType, role: "from_source" }, { plan: to, type: selection.toSourceType, role: "to_source" }], context);
      return withMojoValue(ordered.before, runtimeCall(selection.optional ? "project_optional_location" : "project_location", ordered.values, [sourcePointee, selection.pointeeType]));
    }
  }
}

function method(receiver: MojoExpression, name: string, values: readonly MojoExpression[] = []): MojoExpression {
  return Object.freeze({ kind: "method-call", receiver, name, arguments: Object.freeze(values.map((value) => Object.freeze({ value }))) });
}

function construct(type: MojoTargetTypeRef, values: readonly MojoExpression[]): MojoExpression {
  return Object.freeze({ kind: "construct", type, arguments: Object.freeze(values.map((value) => Object.freeze({ value }))) });
}
