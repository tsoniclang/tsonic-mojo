import type { Node } from "@tsonic/tsts";
import {
  DoStatement_Statement,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IterationStatement_Statement,
  Node_Expression,
  Node_Initializer,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type { MojoAnalyzedFunction } from "../../analysis/program/model.js";
import type { MojoStatement } from "../target-ast/nodes.js";
import type { MojoPlanningContext } from "./context.js";
import { appendMojoPlanningDiagnostic } from "./context.js";
import { planMojoAssignment, planMojoExpression, planMojoUpdate } from "./expressions.js";
import { registerMojoTypeImports } from "./types/render.js";

export function planMojoFunctionStatements(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  return planBlock(function_.body, function_, context, emptyFlowContext);
}

interface MojoFlowPlanningContext {
  readonly continuePrefix: readonly MojoStatement[];
}

const emptyFlowContext: MojoFlowPlanningContext = Object.freeze({ continuePrefix: Object.freeze([]) });

function planBlock(
  block: Node,
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  const statements: MojoStatement[] = [];
  for (const sourceStatement of context.program.source.ast.statements(block)) {
    if (sourceStatement === undefined) continue;
    const planned = planStatement(sourceStatement, function_, context, flow);
    if (planned === undefined) return undefined;
    statements.push(...planned);
  }
  return Object.freeze(statements);
}

function planStatement(
  node: Node,
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
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
    const update = sourceExpression === undefined ? undefined : planMojoUpdate(sourceExpression, context);
    if (update !== undefined) return Object.freeze([{ kind: "assignment", ...update }]);
    const expression = sourceExpression === undefined ? undefined : planMojoExpression(sourceExpression, context);
    return expression === undefined ? undefined : Object.freeze([{ kind: "expression", expression }]);
  }
  if (ast.is.IsVariableStatement(node)) {
    return planVariableDeclarationList(VariableStatement_DeclarationList(ast, node), context);
  }
  if (ast.is.IsIfStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const thenNode = ast.as.AsIfStatement(node)?.ThenStatement;
    const elseNode = ast.as.AsIfStatement(node)?.ElseStatement;
    const condition = conditionNode === undefined
      ? undefined
      : planMojoExpression(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const thenStatements = thenNode === undefined ? undefined : planStatementBody(thenNode, function_, context, flow);
    const elseStatements = elseNode === undefined ? undefined : planStatementBody(elseNode, function_, context, flow);
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
    const statements = body === undefined
      ? undefined
      : planStatementBody(body, function_, context, emptyFlowContext);
    return condition === undefined || statements === undefined
      ? undefined
      : Object.freeze([{ kind: "while", condition, statements }]);
  }
  if (ast.is.IsDoStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const body = DoStatement_Statement(ast, node);
    const condition = conditionNode === undefined
      ? undefined
      : planMojoExpression(conditionNode, context, { kind: "source-primitive", name: "bool" });
    if (condition === undefined || body === undefined) return undefined;
    const conditionExit: MojoStatement = Object.freeze({
      kind: "if",
      condition: Object.freeze({ kind: "unary", operator: "not", operand: condition }),
      thenStatements: Object.freeze([Object.freeze({ kind: "break" as const })]),
    });
    const statements = planStatementBody(
      body,
      function_,
      context,
      Object.freeze({ continuePrefix: Object.freeze([conditionExit]) }),
    );
    return statements === undefined
      ? undefined
      : Object.freeze([{
          kind: "while",
          condition: Object.freeze({ kind: "bool-literal", value: true }),
          statements: Object.freeze([...statements, conditionExit]),
        }]);
  }
  if (ast.is.IsForStatement(node)) {
    const initializer = planForInitializer(ForStatement_Initializer(ast, node), context);
    const conditionNode = ForStatement_Condition(ast, node);
    const condition = conditionNode === undefined
      ? Object.freeze({ kind: "bool-literal" as const, value: true })
      : planMojoExpression(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const increment = planForIncrement(ForStatement_Incrementor(ast, node), context);
    const body = IterationStatement_Statement(ast, node);
    if (initializer === undefined || condition === undefined || increment === undefined || body === undefined) {
      return undefined;
    }
    const statements = planStatementBody(
      body,
      function_,
      context,
      Object.freeze({ continuePrefix: increment }),
    );
    if (statements === undefined) return undefined;
    return Object.freeze([
      ...initializer,
      Object.freeze({ kind: "while", condition, statements: Object.freeze([...statements, ...increment]) }),
    ]);
  }
  if (ast.is.IsForOfStatement(node) || ast.is.IsForInStatement(node)) {
    const selection = context.program.queries.iterationSelection(node);
    const body = ForInOrOfStatement_Statement(ast, node);
    if (selection === undefined || body === undefined) return undefined;
    const sourceIterable = planMojoExpression(selection.iterable, context, selection.iterableType);
    if (sourceIterable === undefined) return undefined;
    const iterable = selection.target === "dictionary-keys"
      ? Object.freeze({
          kind: "method-call" as const,
          receiver: sourceIterable,
          name: "keys",
          arguments: Object.freeze([]),
        })
      : sourceIterable;
    const statements = planStatementBody(body, function_, context, emptyFlowContext);
    return statements === undefined
      ? undefined
      : Object.freeze([{ kind: "for", binding: selection.bindingName, iterable, statements }]);
  }
  if (ast.is.IsBreakStatement(node)) return Object.freeze([{ kind: "break" }]);
  if (ast.is.IsContinueStatement(node)) {
    return Object.freeze([...flow.continuePrefix, Object.freeze({ kind: "continue" as const })]);
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
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  return context.program.source.ast.is.IsBlock(node)
    ? planBlock(node, function_, context, flow)
    : planStatement(node, function_, context, flow);
}

function planVariableDeclarationList(
  list: Node | undefined,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  if (list === undefined || !ast.is.IsVariableDeclarationList(list)) return undefined;
  const declarations = VariableDeclarationList_Declarations(ast, list) ?? [];
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

function planForInitializer(
  initializer: Node | undefined,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (initializer === undefined) return Object.freeze([]);
  const { ast } = context.program.source;
  if (ast.is.IsVariableDeclarationList(initializer)) {
    return planVariableDeclarationList(initializer, context);
  }
  const assignment = planMojoAssignment(initializer, context);
  if (assignment !== undefined) return Object.freeze([{ kind: "assignment", ...assignment }]);
  const update = planMojoUpdate(initializer, context);
  if (update !== undefined) return Object.freeze([{ kind: "assignment", ...update }]);
  const expression = planMojoExpression(initializer, context);
  return expression === undefined ? undefined : Object.freeze([{ kind: "expression", expression }]);
}

function planForIncrement(
  incrementor: Node | undefined,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (incrementor === undefined) return Object.freeze([]);
  const assignment = planMojoAssignment(incrementor, context);
  if (assignment !== undefined) return Object.freeze([{ kind: "assignment", ...assignment }]);
  const update = planMojoUpdate(incrementor, context);
  if (update !== undefined) return Object.freeze([{ kind: "assignment", ...update }]);
  const expression = planMojoExpression(incrementor, context);
  return expression === undefined ? undefined : Object.freeze([{ kind: "expression", expression }]);
}
