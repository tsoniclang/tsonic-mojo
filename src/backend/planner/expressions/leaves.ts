import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../../target-ast/index.js";
import {
  appendMojoPlanningDiagnostic,
  mojoBindingPlanOverride,
  mojoQualifiedModuleMember,
  registerMojoModuleImport,
} from "../program/context.js";
import type { MojoPlanningContext } from "../program/context.js";
import { isJsString, planProviderConstant } from "./support.js";
import { mojoModuleBindingRead } from "../bindings/module-bindings.js";
import { registerMojoTypeImports } from "../types/render.js";
import type { MojoValueRefinementSelection } from "../../../analysis/program/model.js";

export function planMojoLeafExpression(
  node: Node,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const { ast } = context.program.source;
  const actualType = context.program.queries.expressionType(node);
  let planned: MojoExpression | undefined;
  if (actualType?.kind === "null" || actualType?.kind === "undefined") {
    registerMojoTypeImports(actualType, context);
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([]) };
  } else if (ast.is.IsIdentifier(node) || ast.kindName(node) === "KindThisKeyword") {
    const override = mojoBindingPlanOverride(node, context);
    const selectedValue = context.program.queries.valueSelection(node);
    if (override !== undefined) {
      planned = override.storage === "location"
        ? {
            kind: "method-call",
            receiver: override.expression,
            name: "read",
            arguments: Object.freeze([]),
          }
        : override.expression;
    } else if (selectedValue !== undefined) {
      planned = planProviderConstant(selectedValue.operation, selectedValue.resultConversion, context);
      if (planned === undefined) return undefined;
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
          planned = {
            kind: "path",
            path: ownerModule === undefined
              ? name
              : mojoQualifiedModuleMember(context, ownerModule.modulePath, name),
          };
        }
      }
    }
  } else if (ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) {
    planned = { kind: "string-literal", value: ast.text(node) };
  } else if (ast.is.IsNumericLiteral(node)) {
    planned = { kind: "number-literal", text: ast.text(node) };
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
    registerMojoModuleImport(context, ["tsonic_js"]);
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([{ value: planned }]) };
  }
  return applyValueRefinement(planned, context.program.queries.valueRefinement(node), context);
}

export function applyValueRefinement(
  expression: MojoExpression,
  refinement: MojoValueRefinementSelection | undefined,
  context: MojoPlanningContext,
): MojoExpression {
  if (refinement === undefined) return expression;
  registerMojoTypeImports(refinement.sourceType, context);
  registerMojoTypeImports(refinement.resultType, context);
  return refinement.kind === "optional-present"
    ? Object.freeze({
        kind: "method-call",
        receiver: expression,
        name: "value",
        arguments: Object.freeze([]),
      })
    : refinement.kind === "union-member"
      ? Object.freeze({ kind: "type-element", receiver: expression, type: refinement.resultType })
      : planUnionSubsetRefinement(expression, refinement, context);
}

function planUnionSubsetRefinement(
  expression: MojoExpression,
  refinement: Extract<MojoValueRefinementSelection, { readonly kind: "union-subset" }>,
  context: MojoPlanningContext,
): MojoExpression {
  let result: MojoExpression | undefined;
  for (let index = refinement.resultType.members.length - 1; index >= 0; index -= 1) {
    const member = refinement.resultType.members[index]!;
    registerMojoTypeImports(member, context);
    const projected: MojoExpression = Object.freeze({
      kind: "construct",
      type: refinement.resultType,
      arguments: Object.freeze([{ value: Object.freeze({
        kind: "type-element",
        receiver: expression,
        type: member,
      }) }]),
    });
    result = result === undefined
      ? projected
      : Object.freeze({
          kind: "conditional",
          condition: Object.freeze({
            kind: "method-call",
            receiver: expression,
            name: "isa",
            genericArguments: Object.freeze([{ kind: "type" as const, type: member }]),
            arguments: Object.freeze([]),
          }),
          whenTrue: projected,
          whenFalse: result,
        });
  }
  return result!;
}
