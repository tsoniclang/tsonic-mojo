import type { Node } from "@tsonic/tsts";
import {
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { MojoAnalyzedFunction } from "../../analysis/program/model.js";
import type { MojoStatement } from "../target-ast/nodes.js";
import type { MojoPlanningContext } from "./context.js";
import { appendMojoPlanningDiagnostic } from "./context.js";
import { planMojoAssignment, planMojoExpression } from "./expressions.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoFunctionStatements(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  return planBlock(function_.body, function_, context);
}

function planBlock(
  block: Node,
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const statements: MojoStatement[] = [];
  for (const sourceStatement of context.program.source.ast.statements(block)) {
    if (sourceStatement === undefined) continue;
    const planned = planStatement(sourceStatement, function_, context);
    if (planned === undefined) return undefined;
    statements.push(...planned);
  }
  return Object.freeze(statements);
}

function planStatement(
  node: Node,
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  if (ast.is.IsReturnStatement(node)) {
    const sourceExpression = Node_Expression(ast, node);
    const expression = sourceExpression === undefined
      ? undefined
      : planMojoExpression(sourceExpression, context, function_.resultType);
    if (sourceExpression !== undefined && expression === undefined) return undefined;
    return Object.freeze([{ kind: "return", ...(expression === undefined ? {} : { expression }) }]);
  }
  if (ast.is.IsExpressionStatement(node)) {
    const sourceExpression = Node_Expression(ast, node);
    const assignment = sourceExpression === undefined
      ? undefined
      : planMojoAssignment(sourceExpression, context);
    if (assignment !== undefined) {
      return Object.freeze([{ kind: "assignment", ...assignment }]);
    }
    const expression = sourceExpression === undefined ? undefined : planMojoExpression(sourceExpression, context);
    return expression === undefined ? undefined : Object.freeze([{ kind: "expression", expression }]);
  }
  if (ast.is.IsVariableStatement(node)) {
    const declarations = VariableDeclarationList_Declarations(
      ast,
      VariableStatement_DeclarationList(ast, node),
    ) ?? [];
    const planned: MojoStatement[] = [];
    for (const declaration of declarations) {
      if (declaration === undefined) return undefined;
      const name = context.program.queries.bindingName(declaration);
      const type = context.program.queries.bindingType(declaration);
      const sourceInitializer = Node_Initializer(ast, declaration);
      if (name === undefined || type === undefined || sourceInitializer === undefined) return undefined;
      const initializer = planMojoExpression(sourceInitializer, context, type);
      if (initializer === undefined) return undefined;
      registerMojoTypeImports(type, context);
      planned.push({ kind: "variable", name, type, initializer });
    }
    return Object.freeze(planned);
  }
  if (ast.is.IsIfStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const thenNode = ast.as.AsIfStatement(node)?.ThenStatement;
    const elseNode = ast.as.AsIfStatement(node)?.ElseStatement;
    const condition = conditionNode === undefined
      ? undefined
      : planMojoExpression(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const thenStatements = thenNode === undefined ? undefined : planStatementBody(thenNode, function_, context);
    const elseStatements = elseNode === undefined ? undefined : planStatementBody(elseNode, function_, context);
    if (condition === undefined || thenStatements === undefined ||
      (elseNode !== undefined && elseStatements === undefined)) return undefined;
    return Object.freeze([{
      kind: "if",
      condition,
      thenStatements,
      ...(elseStatements === undefined ? {} : { elseStatements }),
    }]);
  }
  if (ast.is.IsWhileStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const body = ast.as.AsWhileStatement(node)?.Statement;
    const condition = conditionNode === undefined
      ? undefined
      : planMojoExpression(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const statements = body === undefined ? undefined : planStatementBody(body, function_, context);
    return condition === undefined || statements === undefined
      ? undefined
      : Object.freeze([{ kind: "while", condition, statements }]);
  }
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_STATEMENT_PLAN_UNSUPPORTED",
    `Statement kind '${ast.kindName(node)}' reached planning without a Mojo form.`,
    node,
  );
  return undefined;
}

function planStatementBody(
  node: Node,
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  return context.program.source.ast.is.IsBlock(node)
    ? planBlock(node, function_, context)
    : planStatement(node, function_, context);
}
