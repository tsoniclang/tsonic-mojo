import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoBindingPlanOverride,
  mojoModuleMemberExpression,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { isJsString } from "./js-carriers.js";
import { mojoModuleBindingRead } from "../bindings/module-bindings.js";
import { registerMojoTypeImports } from "../types/imports.js";
import type { MojoNarrowingView } from "../../../analysis/representations/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";

export function planMojoLeafExpression(
  node: Node,
  context: MojoPlanningContext,
  numericTargetType?: MojoTargetTypeRef,
): MojoExpression | undefined {
  const { ast } = context.program.source;
  const actualType = context.program.queries.expressionType(node);
  let planned: MojoExpression | undefined;
  if (actualType?.kind === "null" || actualType?.kind === "undefined") {
    registerMojoTypeImports(actualType, context);
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([]) };
  } else if (ast.is.IsIdentifier(node) || ast.kindName(node) === "KindThisKeyword") {
    const override = mojoBindingPlanOverride(node, context);
    if (override !== undefined) {
      planned = override.storage === "location"
        ? {
            kind: "method-call",
            receiver: override.expression,
            name: "read",
            arguments: Object.freeze([]),
          }
        : override.expression;
    } else {
      const locationStorage = context.program.queries.locationStorage(node);
      if (locationStorage !== undefined) {
        planned = {
          kind: "method-call",
          receiver: { kind: "path", path: locationStorage.name },
          name: "read",
          arguments: Object.freeze([]),
        };
      } else {
        const moduleBinding = context.program.queries.moduleBinding(node);
        if (moduleBinding !== undefined) {
          planned = mojoModuleBindingRead(moduleBinding, context);
          if (planned === undefined) {
            appendMojoPlanningDiagnostic(
              context,
              "MOJO_MODULE_BINDING_PLAN_MISSING",
              `Module binding '${moduleBinding.sourceName}' has no sealed Mojo storage path.`,
              node,
            );
            return undefined;
          }
        } else {
          const name = context.program.queries.bindingName(node);
          if (name === undefined) {
            appendMojoPlanningDiagnostic(
              context,
              "MOJO_IDENTIFIER_PLAN_MISSING",
              `Identifier '${ast.text(node)}' has no sealed target binding.`,
              node,
            );
            return undefined;
          }
          const ownerModule = context.program.modules.forSourceFile(
            context.program.queries.bindingSourceFile(node),
          );
          planned = ownerModule === undefined
            ? { kind: "path", path: name }
            : mojoModuleMemberExpression(context, ownerModule.modulePath, name);
        }
      }
    }
  } else if (ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) {
    planned = { kind: "string-literal", value: ast.text(node) };
  } else if (ast.is.IsNumericLiteral(node)) {
    const literal = Object.freeze({ kind: "number-literal" as const, text: ast.text(node) });
    const targetType = numericTargetType ?? actualType;
    planned = targetType?.kind === "source-primitive"
      ? Object.freeze({
          kind: "construct",
          type: targetType,
          arguments: Object.freeze([Object.freeze({ value: literal })]),
        })
      : literal;
  } else if (ast.is.IsBigIntLiteral(node)) {
    const text = ast.text(node);
    if (!text.endsWith("n")) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_BIGINT_LITERAL_INVALID",
        "A TypeScript bigint literal must retain its exact bigint suffix through source checking.",
        node,
      );
      return undefined;
    }
    planned = { kind: "number-literal", text: text.slice(0, -1) };
  } else if (ast.kindName(node) === "KindTrueKeyword" || ast.kindName(node) === "KindFalseKeyword") {
    planned = { kind: "bool-literal", value: ast.kindName(node) === "KindTrueKeyword" };
  } else {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_EXPRESSION_PLAN_UNSUPPORTED",
      `Expression kind '${ast.kindName(node)}' reached planning without a Mojo form.`,
      node,
    );
    return undefined;
  }
  if ((ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) &&
    actualType !== undefined && isJsString(actualType)) {
    registerMojoTypeImports(actualType, context);
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([{ value: planned }]) };
  }
  return applyValueRefinement(planned, context.program.representations.narrowing(node), context);
}

export function applyValueRefinement(
  expression: MojoExpression,
  refinement: MojoNarrowingView | undefined,
  context: MojoPlanningContext,
): MojoExpression {
  if (refinement === undefined) return expression;
  const sourceCarrier = context.program.representations.carrier(refinement.carrier);
  if (sourceCarrier !== undefined) registerMojoTypeImports(sourceCarrier.type, context);
  return refinement.kind === "optional-present"
    ? Object.freeze({
        kind: "method-call",
        receiver: expression,
        name: "value",
        arguments: Object.freeze([]),
      })
    : refinement.kind === "union-member"
      ? Object.freeze({ kind: "type-element", receiver: expression, type: refinement.member.type })
      : expression;
}
