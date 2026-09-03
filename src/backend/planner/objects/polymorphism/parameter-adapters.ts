import type {
  MojoAnalyzedParameter,
  MojoProjectDispatchParameterAdapter,
} from "../../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../../target-model/types/model.js";
import type {
  MojoCallArgument,
  MojoExpression,
  MojoStatement,
} from "../../../target-ast/index.js";
import {
  convertMojoValue,
} from "../../expressions/support.js";
import {
  consumeMojoValue,
  mojoValue,
} from "../../expressions/value-plan.js";
import {
  allocateMojoSyntheticName,
} from "../../program/context.js";
import type { MojoPlanningContext } from "../../program/context.js";
import { registerMojoTypeImports } from "../../types/imports.js";

export function planMojoProjectDispatchArguments(
  adapters: readonly MojoProjectDispatchParameterAdapter[],
  context: MojoPlanningContext,
): {
  readonly before: readonly MojoStatement[];
  readonly arguments: readonly MojoCallArgument[];
} | undefined {
  const before: MojoStatement[] = [];
  const arguments_: MojoCallArgument[] = [];
  for (const adapter of adapters) {
    if (adapter.kind === "omitted") {
      if (adapter.target.callType.kind !== "optional") return undefined;
      arguments_.push(Object.freeze({ value: Object.freeze({ kind: "none-literal" }) }));
      continue;
    }
    if (adapter.kind === "value") {
      const converted = convertMojoValue(
        mojoValue(parameterValue(adapter.source)),
        adapter.conversion,
        context,
      );
      if (converted === undefined) return undefined;
      before.push(...converted.before);
      arguments_.push(Object.freeze({
        value: transferToTarget(converted.value, adapter.target, adapter.target.callType, context),
      }));
      continue;
    }
    if (adapter.kind === "fixed-rest") {
      if (adapter.sources.length !== adapter.sourceIndexes.length ||
        adapter.sources.length !== adapter.conversions.length) return undefined;
      for (const [index, source] of adapter.sources.entries()) {
        const conversion = adapter.conversions[index];
        if (conversion === undefined) return undefined;
        const converted = convertMojoValue(
          mojoValue(parameterValue(source)),
          conversion,
          context,
        );
        if (converted === undefined) return undefined;
        before.push(...converted.before);
        arguments_.push(Object.freeze({
          value: transferToTarget(converted.value, adapter.target, adapter.target.type, context),
        }));
      }
      continue;
    }
    if (adapter.elementConversion.kind === "identity") {
      arguments_.push(Object.freeze({ value: parameterValue(adapter.source), spread: true }));
      continue;
    }
    const listType: MojoTargetTypeRef = Object.freeze({
      kind: "list",
      element: adapter.target.type,
    });
    registerMojoTypeImports(listType, context);
    const valuesName = allocateMojoSyntheticName(context, "dispatch_rest_values");
    const itemName = allocateMojoSyntheticName(context, "dispatch_rest_item");
    const converted = convertMojoValue(
      mojoValue(Object.freeze({ kind: "path", path: itemName })),
      adapter.elementConversion,
      context,
    );
    if (converted === undefined) return undefined;
    before.push(
      Object.freeze({
        kind: "variable",
        name: valuesName,
        type: listType,
        initializer: Object.freeze({
          kind: "construct",
          type: listType,
          arguments: Object.freeze([]),
        }),
      }),
      Object.freeze({
        kind: "for",
        binding: itemName,
        iterable: parameterValue(adapter.source),
        statements: Object.freeze([
          ...converted.before,
          Object.freeze({
            kind: "expression",
            expression: Object.freeze({
              kind: "method-call",
              receiver: Object.freeze({ kind: "path", path: valuesName }),
              name: "append",
              arguments: Object.freeze([Object.freeze({
                value: transferToTarget(
                  converted.value,
                  adapter.target,
                  adapter.target.type,
                  context,
                ),
              })]),
            }),
          }),
        ]),
      }),
    );
    arguments_.push(Object.freeze({
      value: Object.freeze({ kind: "path", path: valuesName }),
      spread: true,
    }));
  }
  return Object.freeze({
    before: Object.freeze(before),
    arguments: Object.freeze(arguments_),
  });
}

function parameterValue(parameter: MojoAnalyzedParameter): MojoExpression {
  return Object.freeze({ kind: "path", path: parameter.incomingName });
}

function transferToTarget(
  value: MojoExpression,
  target: MojoAnalyzedParameter,
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoExpression {
  return target.disposition.kind === "owned"
    ? consumeMojoValue(value, type, context.program.lifecycle)
    : value;
}
