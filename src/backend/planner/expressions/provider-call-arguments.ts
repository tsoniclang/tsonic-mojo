import type { MojoCallSelection } from "../../../analysis/program/call-model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import {
  allocateMojoSyntheticName,
  appendMojoPlanningDiagnostic,
  mojoTargetTypeInContext,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planSelectedArguments } from "./call-support.js";
import { orderMojoValues } from "./support.js";
import type { MojoValuePlanner, PlannedMojoCallArgument } from "./support.js";
import { withMojoValue } from "./value-plan.js";

export function planMojoProviderCallArguments(
  selection: Extract<MojoCallSelection, { readonly kind: "provider" }>,
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
): readonly PlannedMojoCallArgument[] | undefined {
  const planned = planSelectedArguments(selection.arguments, context, planValue);
  if (planned === undefined) return undefined;
  const target = selection.operation.target;
  if (target.kind !== "function-call" && target.kind !== "instance-call") return undefined;
  if (!target.arguments.some((argument) => argument.restPacking === "list")) return planned;
  const result: PlannedMojoCallArgument[] = [];
  for (const [parameterIndex, parameter] of target.arguments.entries()) {
    const indexes = selection.arguments.flatMap((argument, index) =>
      argument.parameterIndex === parameterIndex ? [index] : []);
    if (parameter.restPacking !== "list") {
      result.push(...indexes.map((index) => planned[index]!));
      continue;
    }
    const element = mojoTargetTypeInContext(selection.operation.parameterTypes[parameterIndex]!, context);
    const type = Object.freeze({ kind: "list" as const, element });
    registerMojoTypeImports(type, context);
    const items = indexes.map((index) => planned[index]!);
    let value: MojoExpression;
    let before: readonly MojoStatement[];
    if (items.every((item) => !item.spread)) {
      const ordered = orderMojoValues(items.map((item) => Object.freeze({
        plan: item.plan, type: item.type, role: "rest_argument",
      })), context);
      before = ordered.before;
      value = items.length === 0
        ? Object.freeze({ kind: "construct", type, arguments: Object.freeze([]) })
        : Object.freeze({ kind: "list", elements: ordered.values });
    } else {
      const name = allocateMojoSyntheticName(context, "rest_values");
      const statements: MojoStatement[] = [Object.freeze({
        kind: "variable", name, type,
        initializer: Object.freeze({ kind: "construct", type, arguments: Object.freeze([]) }),
      })];
      for (const [itemIndex, item] of items.entries()) {
        statements.push(...item.plan.before);
        if (!item.spread) {
          statements.push(append(name, item.plan.value));
          continue;
        }
        const iterable = item.type.kind === "list" || item.type.kind === "fixed-array"
          ? item.plan.value
          : item.type.kind === "target-named" && item.type.id === "tsonic.mojo.js.JsArray"
            ? Object.freeze({
                kind: "method-call" as const, receiver: item.plan.value,
                name: "iter_values", arguments: Object.freeze([]),
              })
            : undefined;
        if (iterable === undefined) {
          appendMojoPlanningDiagnostic(context, "MOJO_CALLABLE_REST_SPREAD_CARRIER_INVALID",
            "A packed provider rest argument requires an exact iterable collection carrier.",
            selection.arguments[indexes[itemIndex]!]!.expression);
          return undefined;
        }
        const itemName = allocateMojoSyntheticName(context, "rest_item");
        statements.push(Object.freeze({
          kind: "for", binding: itemName, iterable,
          statements: Object.freeze([append(name, Object.freeze({
            kind: "copy", expression: Object.freeze({ kind: "path", path: itemName }),
          }))]),
        }));
      }
      before = Object.freeze(statements);
      value = Object.freeze({ kind: "path", path: name });
    }
    result.push(Object.freeze({
      plan: withMojoValue(before, value), type, spread: false,
      ...(parameter.position === "keyword" ? { name: parameter.nativeName! } : {}),
    }));
  }
  return Object.freeze(result);
}

function append(name: string, value: MojoExpression): MojoStatement {
  return Object.freeze({
    kind: "expression", expression: Object.freeze({
      kind: "method-call", receiver: Object.freeze({ kind: "path", path: name }),
      name: "append", arguments: Object.freeze([{ value }]),
    }),
  });
}
