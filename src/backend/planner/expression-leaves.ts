import type { Node } from "@tsonic/tsts";
import type { MojoExpression } from "../target-ast/nodes.js";
import {
  appendMojoPlanningDiagnostic,
  mojoQualifiedModuleMember,
  registerMojoModuleImport,
} from "./context.js";
import type { MojoPlanningContext } from "./context.js";
import { isJsString, planProviderConstant } from "./expression-support.js";
import { mojoModuleBindingRead } from "./module-bindings.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoLeafExpression(
  node: Node,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const { ast } = context.program.source;
  let planned: MojoExpression | undefined;
  if (ast.is.IsIdentifier(node) || ast.kindName(node) === "KindThisKeyword") {
    const selectedValue = context.program.queries.valueSelection(node);
    if (selectedValue !== undefined) {
      planned = planProviderConstant(selectedValue.operation, selectedValue.resultConversion, context);
      if (planned === undefined) return undefined;
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
  } else if (ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) {
    planned = { kind: "string-literal", value: ast.text(node) };
  } else if (ast.is.IsNumericLiteral(node)) {
    planned = { kind: "number-literal", text: ast.text(node) };
  } else if (ast.kindName(node) === "KindTrueKeyword" || ast.kindName(node) === "KindFalseKeyword") {
    planned = { kind: "bool-literal", value: ast.kindName(node) === "KindTrueKeyword" };
  } else if (ast.kindName(node) === "KindNullKeyword" || ast.kindName(node) === "KindUndefinedKeyword") {
    const type = context.program.queries.expressionType(node);
    if (type === undefined || (type.kind !== "null" && type.kind !== "undefined")) return undefined;
    registerMojoTypeImports(type, context);
    planned = { kind: "construct", type, arguments: Object.freeze([]) };
  } else {
    appendMojoPlanningDiagnostic(
      context,
      "MOJO_EXPRESSION_PLAN_UNSUPPORTED",
      `Expression kind '${ast.kindName(node)}' reached planning without a Mojo form.`,
      node,
    );
    return undefined;
  }
  const actualType = context.program.queries.expressionType(node);
  if ((ast.is.IsStringLiteral(node) || ast.is.IsNoSubstitutionTemplateLiteral(node)) &&
    actualType !== undefined && isJsString(actualType)) {
    registerMojoModuleImport(context, ["tsonic_js"]);
    planned = { kind: "construct", type: actualType, arguments: Object.freeze([{ value: planned }]) };
  }
  return planned;
}
