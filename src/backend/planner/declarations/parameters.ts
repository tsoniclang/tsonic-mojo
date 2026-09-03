import type { MojoAnalyzedParameter } from "../../../analysis/program/model.js";
import { mojoTargetTypeEquals } from "../../../target-model/types/equality.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoExpression,
  MojoParameter,
  MojoStatement,
} from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import type { MojoValuePlanner } from "../expressions/support.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { mojoParameterConvention } from "../../../analysis/representations/index.js";

export function planMojoParameterDeclaration(
  parameter: MojoAnalyzedParameter,
  context: MojoPlanningContext,
): MojoParameter {
  const type = parameter.omissionKind === "rest" ? parameter.type : parameter.callType;
  registerMojoTypeImports(type, context);
  return Object.freeze({
    name: parameter.incomingName,
    type,
    convention: mojoParameterConvention(parameter.disposition),
    variadic: parameter.omissionKind === "rest",
    ...(parameter.omissionKind === "undefined" || parameter.omissionKind === "initializer"
      ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
      : {}),
  });
}

export function planMojoParameterPrelude(
  parameters: readonly MojoAnalyzedParameter[],
  context: MojoPlanningContext,
  planValue: MojoValuePlanner,
  normalizeRest: boolean,
): readonly MojoStatement[] | undefined {
  const statements: MojoStatement[] = [];
  for (const parameter of parameters) {
    if (parameter.omissionKind === "initializer") {
      const initializer = parameter.initializer;
      if (initializer === undefined || parameter.callType.kind !== "optional") {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_DEFAULT_PARAMETER_CONTRACT_INVALID",
          "A defaulted source parameter requires one exact initializer and Optional input slot.",
          parameter.declaration,
        );
        return undefined;
      }
      const fallback = planValue(initializer, context, parameter.bodyType);
      if (fallback === undefined) return undefined;
      const slot = Object.freeze({ kind: "path" as const, path: parameter.incomingName });
      const present = defaultParameterPresentValue(parameter, slot);
      if (present === undefined) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_DEFAULT_PARAMETER_CARRIER_INVALID",
          "A defaulted source parameter input slot cannot be reconciled with its exact body carrier.",
          parameter.declaration,
        );
        return undefined;
      }
      registerMojoTypeImports(parameter.bodyType, context);
      statements.push(
        Object.freeze({ kind: "variable", name: parameter.name, type: parameter.bodyType }),
        Object.freeze({
          kind: "if",
          condition: slot,
          thenStatements: Object.freeze([Object.freeze({
            kind: "assignment",
            operator: "=",
            left: Object.freeze({ kind: "path", path: parameter.name }),
            right: present,
          })]),
          elseStatements: Object.freeze([
            ...fallback.before,
            Object.freeze({
              kind: "assignment" as const,
              operator: "=",
              left: Object.freeze({ kind: "path" as const, path: parameter.name }),
              right: fallback.value,
            }),
          ]),
        }),
      );
      continue;
    }
    if (parameter.disposition.kind === "immutable" && parameter.disposition.localCopy &&
      parameter.omissionKind !== "rest") {
      registerMojoTypeImports(parameter.bodyType, context);
      statements.push(Object.freeze({
        kind: "variable",
        name: parameter.name,
        type: parameter.bodyType,
        initializer: Object.freeze({ kind: "path", path: parameter.incomingName }),
      }));
      continue;
    }
    if (parameter.omissionKind !== "rest" || !normalizeRest) continue;
    const normalized = normalizeRestParameter(parameter);
    if (normalized === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_REST_PARAMETER_CARRIER_INVALID",
        "A source rest parameter requires one exact native List or JavaScript array body carrier.",
        parameter.declaration,
      );
      return undefined;
    }
    registerMojoTypeImports(parameter.bodyType, context);
    statements.push(Object.freeze({
      kind: "variable",
      name: parameter.name,
      type: parameter.bodyType,
      initializer: normalized,
    }));
  }
  return Object.freeze(statements);
}

function defaultParameterPresentValue(
  parameter: MojoAnalyzedParameter,
  slot: MojoExpression,
): MojoExpression | undefined {
  if (parameter.callType.kind !== "optional") return undefined;
  if (mojoTargetTypeEquals(parameter.callType, parameter.bodyType)) return slot;
  if (!mojoTargetTypeEquals(parameter.callType.value, parameter.bodyType)) return undefined;
  return Object.freeze({
    kind: "method-call",
    receiver: slot,
    name: "value",
    arguments: Object.freeze([]),
  });
}

function normalizeRestParameter(
  parameter: MojoAnalyzedParameter,
): MojoExpression | undefined {
  const input = Object.freeze({ kind: "path" as const, path: parameter.incomingName });
  if (parameter.bodyType.kind === "list") {
    return Object.freeze({
      kind: "construct",
      type: parameter.bodyType,
      arguments: Object.freeze([{ value: input }]),
    });
  }
  if (parameter.bodyType.kind !== "target-named" ||
    parameter.bodyType.id !== "tsonic.mojo.js.JsArray") return undefined;
  const argument = parameter.bodyType.genericArguments?.[0];
  if (argument?.kind !== "type") return undefined;
  const listType: MojoTargetTypeRef = Object.freeze({ kind: "list", element: argument.type });
  return Object.freeze({
    kind: "construct",
    type: parameter.bodyType,
    arguments: Object.freeze([{ value: Object.freeze({
      kind: "construct",
      type: listType,
      arguments: Object.freeze([{ value: input }]),
    }) }]),
  });
}
