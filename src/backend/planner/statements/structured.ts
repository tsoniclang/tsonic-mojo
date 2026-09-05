import type { Node } from "@tsonic/tsts";
import {
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  DoStatement_Statement,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IterationStatement_Statement,
  Node_Expression,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import type {
  MojoAnalyzedFunction,
  MojoIterationSelection,
} from "../../../analysis/program/model.js";
import type { MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { appendMojoPlanningDiagnostic, withMojoErrorType } from "../program/context.js";
import { planMojoValue } from "../expressions/value.js";
import { planMojoAssignment } from "../expressions/assignments.js";
import { planMojoUpdate } from "../expressions/updates.js";
import { consumeMojoValue } from "../expressions/value-plan.js";
import { planDiscardedMojoExpression } from "./discarded-expression.js";
import { planForIncrement } from "./for-increment.js";
import { planMojoResourceScope } from "./resources.js";
import type {
  MojoFlowPlanningContext,
  MojoStatementPlanningScope,
} from "./statement-planning-model.js";
import { planMojoSwitchStatement } from "./switch-statements.js";
import {
  initializerResourceDeclarationList,
  planForInitializer,
  planResourceDeclarations,
  planVariableDeclarationList,
  resourceDeclarationList,
} from "./variable-statements.js";
import {
  isMojoCompileTimeCondition,
  isMojoCompileTimeIteration,
  planMojoCompileTimeCondition,
} from "../compile-time/values.js";
import { planMojoBindingProjection } from "../bindings/patterns.js";
import { mojoValue } from "../expressions/value-plan.js";

export function planMojoFunctionStatements(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  omittedStatements: ReadonlySet<Node> = emptyOmittedStatements,
): readonly MojoStatement[] | undefined {
  return planBlock(
    function_.body,
    Object.freeze({ resultType: function_.resultType, returnAllowed: true, omittedStatements }),
    context,
    emptyFlowContext,
  );
}

export function planMojoStatementRegion(
  nodes: readonly (Node | undefined)[],
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  return planStatementNodes(
    nodes,
    Object.freeze({ returnAllowed: false }),
    context,
    emptyFlowContext,
  );
}

const emptyFlowContext: MojoFlowPlanningContext = Object.freeze({});
const emptyOmittedStatements: ReadonlySet<Node> = new Set();

function planBlock(
  block: Node,
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  return planStatementSequence(
    context.program.source.ast.statements(block),
    scope,
    context,
    flow,
  );
}

function planStatementSequence(
  sourceStatements: readonly (Node | undefined)[],
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  const statements: MojoStatement[] = [];
  for (const [index, sourceStatement] of sourceStatements.entries()) {
    if (sourceStatement === undefined) continue;
    if (scope.omittedStatements?.has(sourceStatement) === true) continue;
    const resourceList = resourceDeclarationList(sourceStatement, context);
    if (resourceList !== undefined) {
      const declarations = VariableDeclarationList_Declarations(
        context.program.source.ast,
        resourceList,
      ) ?? [];
      const remainder = planStatementSequence(
        sourceStatements.slice(index + 1),
        scope,
        context,
        flow,
      );
      if (remainder === undefined || declarations.some((declaration) => declaration === undefined)) {
        return undefined;
      }
      const scoped = planResourceDeclarations(
        declarations as readonly Node[],
        remainder,
        context,
      );
      if (scoped === undefined) return undefined;
      statements.push(...scoped);
      return Object.freeze(statements);
    }
    const diagnosticCount = context.diagnostics.length;
    const planned = planStatement(sourceStatement, scope, context, flow);
    if (planned === undefined) {
      if (context.diagnostics.length === diagnosticCount) {
        appendMojoPlanningDiagnostic(
          context,
          "MOJO_STATEMENT_NOT_PLANNED",
          `Statement kind '${context.program.source.ast.kindName(sourceStatement)}' has no exact sealed Mojo plan.`,
          sourceStatement,
        );
      }
      return undefined;
    }
    statements.push(...planned);
  }
  return Object.freeze(statements);
}

function planStatement(
  node: Node,
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  if (ast.is.IsEmptyStatement(node)) return Object.freeze([]);
  if (ast.is.IsDebuggerStatement(node)) {
    return Object.freeze([Object.freeze({
      kind: "expression",
      expression: Object.freeze({
        kind: "call",
        callee: Object.freeze({ kind: "path", path: "breakpoint" }),
        arguments: Object.freeze([]),
      }),
    })]);
  }
  if (ast.is.IsBlock(node)) {
    return planBlock(node, scope, context, flow);
  }
  if (ast.is.IsReturnStatement(node)) {
    if (!scope.returnAllowed || scope.resultType === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_RETURN_OUTSIDE_CALLABLE",
        "A return statement cannot appear in a module or class initialization region.",
        node,
      );
      return undefined;
    }
    const sourceExpression = Node_Expression(ast, node);
    const expression = sourceExpression === undefined
      ? undefined
      : planMojoValue(sourceExpression, context, scope.resultType);
    if (sourceExpression !== undefined && expression === undefined) return undefined;
    const returnedExpression = expression === undefined
      ? undefined
      : context.program.queries.exitValueTransfer(sourceExpression!)
        ? consumeMojoValue(expression.value, scope.resultType, context.program.lifecycle)
        : expression.value;
    return Object.freeze([
      ...(expression?.before ?? []),
      { kind: "return", ...(returnedExpression === undefined ? {} : { expression: returnedExpression }) },
    ]);
  }
  if (ast.is.IsExpressionStatement(node)) {
    const sourceExpression = Node_Expression(ast, node);
    const assignment = sourceExpression === undefined
      ? undefined
      : planMojoAssignment(sourceExpression, context, planMojoValue);
    if (assignment !== undefined) {
      return Object.freeze([
        ...assignment.before,
        assignment.statement,
      ]);
    }
    const update = sourceExpression === undefined
      ? undefined
      : planMojoUpdate(sourceExpression, context, planMojoValue);
    if (update !== undefined) return Object.freeze([
      ...update.before,
      update.statement,
    ]);
    return sourceExpression === undefined
      ? undefined
      : planDiscardedMojoExpression(sourceExpression, context);
  }
  if (ast.is.IsThrowStatement(node)) {
    const sourceExpression = Node_Expression(ast, node);
    const expression = sourceExpression === undefined ? undefined : planMojoValue(sourceExpression, context);
    const type = sourceExpression === undefined ? undefined : context.program.queries.expressionType(sourceExpression);
    if (expression === undefined || type === undefined) return undefined;
    const raised = context.program.queries.exitValueTransfer(sourceExpression!)
      ? consumeMojoValue(expression.value, type, context.program.lifecycle)
      : expression.value;
    return Object.freeze([...expression.before, { kind: "raise", expression: raised }]);
  }
  if (ast.is.IsVariableStatement(node)) {
    return planVariableDeclarationList(VariableStatement_DeclarationList(ast, node), context);
  }
  if (ast.is.IsIfStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const thenNode = ast.as.AsIfStatement(node)?.ThenStatement;
    const elseNode = ast.as.AsIfStatement(node)?.ElseStatement;
    const compileTime = conditionNode !== undefined &&
      isMojoCompileTimeCondition(conditionNode, context);
    const condition = conditionNode === undefined
      ? undefined
      : compileTime
        ? planMojoCompileTimeCondition(conditionNode, context, planMojoValue)
        : planMojoValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const thenStatements = thenNode === undefined ? undefined : planStatementBody(thenNode, scope, context, flow);
    const elseStatements = elseNode === undefined ? undefined : planStatementBody(elseNode, scope, context, flow);
    if (condition === undefined) {
      appendMojoPlanningDiagnostic(
        context,
        "MOJO_IF_CONDITION_NOT_PLANNED",
        "An if statement requires one exact sealed Mojo condition plan.",
        conditionNode ?? node,
      );
      return undefined;
    }
    if (thenStatements === undefined || (elseNode !== undefined && elseStatements === undefined)) return undefined;
    return Object.freeze([...condition.before, {
      kind: "if",
      condition: condition.value,
      thenStatements,
      ...(elseStatements === undefined ? {} : { elseStatements }),
      ...(compileTime ? { compileTime: true } : {}),
    }]);
  }
  if (ast.is.IsWhileStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const body = ast.as.AsWhileStatement(node)?.Statement;
    const condition = conditionNode === undefined
      ? undefined
      : planMojoValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const statements = body === undefined
      ? undefined
      : planStatementBody(body, scope, context, loopFlowContext(Object.freeze([])));
    if (condition === undefined || statements === undefined) return undefined;
    if (condition.before.length === 0) {
      return Object.freeze([{ kind: "while", condition: condition.value, statements }]);
    }
    const conditionExit: MojoStatement = Object.freeze({
      kind: "if",
      condition: Object.freeze({ kind: "unary", operator: "not", operand: condition.value }),
      thenStatements: Object.freeze([Object.freeze({ kind: "break" as const })]),
    });
    return Object.freeze([{
      kind: "while",
      condition: Object.freeze({ kind: "bool-literal", value: true }),
      statements: Object.freeze([...condition.before, conditionExit, ...statements]),
    }]);
  }
  if (ast.is.IsDoStatement(node)) {
    const conditionNode = Node_Expression(ast, node);
    const body = DoStatement_Statement(ast, node);
    const condition = conditionNode === undefined
      ? undefined
      : planMojoValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
    if (condition === undefined || body === undefined) return undefined;
    const conditionExit: MojoStatement = Object.freeze({
      kind: "if",
      condition: Object.freeze({ kind: "unary", operator: "not", operand: condition.value }),
      thenStatements: Object.freeze([Object.freeze({ kind: "break" as const })]),
    });
    const statements = planStatementBody(
      body,
      scope,
      context,
      loopFlowContext(Object.freeze([...condition.before, conditionExit])),
    );
    return statements === undefined
      ? undefined
      : Object.freeze([{
          kind: "while",
          condition: Object.freeze({ kind: "bool-literal", value: true }),
          statements: Object.freeze([...statements, ...condition.before, conditionExit]),
        }]);
  }
  if (ast.is.IsForStatement(node)) {
    const initializerNode = ForStatement_Initializer(ast, node);
    const resourceInitializer = initializerResourceDeclarationList(initializerNode, context);
    const initializer = resourceInitializer === undefined
      ? planForInitializer(initializerNode, context)
      : Object.freeze([]);
    const conditionNode = ForStatement_Condition(ast, node);
    const condition = conditionNode === undefined
      ? Object.freeze({
          before: Object.freeze([]),
          value: Object.freeze({ kind: "bool-literal" as const, value: true }),
        })
      : planMojoValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const increment = planForIncrement(ForStatement_Incrementor(ast, node), context);
    const body = IterationStatement_Statement(ast, node);
    if (initializer === undefined || condition === undefined || increment === undefined || body === undefined) {
      return undefined;
    }
    const statements = planStatementBody(
      body,
      scope,
      context,
      loopFlowContext(increment),
    );
    if (statements === undefined) return undefined;
    const conditionExit: MojoStatement = Object.freeze({
      kind: "if",
      condition: Object.freeze({ kind: "unary", operator: "not", operand: condition.value }),
      thenStatements: Object.freeze([Object.freeze({ kind: "break" as const })]),
    });
    const loop: MojoStatement = Object.freeze({
      kind: "while",
      condition: Object.freeze({ kind: "bool-literal", value: true }),
      statements: Object.freeze([
        ...condition.before,
        conditionExit,
        ...statements,
        ...increment,
      ]),
    });
    if (resourceInitializer === undefined) return Object.freeze([...initializer, loop]);
    const declarations = VariableDeclarationList_Declarations(ast, resourceInitializer) ?? [];
    if (declarations.some((declaration) => declaration === undefined)) return undefined;
    return planResourceDeclarations(declarations as readonly Node[], Object.freeze([loop]), context);
  }
  if (ast.is.IsForOfStatement(node) || ast.is.IsForInStatement(node)) {
    const selection = context.program.queries.iterationSelection(node);
    const body = ForInOrOfStatement_Statement(ast, node);
    if (selection === undefined || body === undefined) return undefined;
    const sourceIterable = planMojoValue(selection.iterable, context);
    if (sourceIterable === undefined) return undefined;
    const iterable = selection.target === "native-values"
      ? sourceIterable.value
      : Object.freeze({
          kind: "method-call" as const,
          receiver: sourceIterable.value,
          name: mojoIterationMethod(selection.target),
          arguments: Object.freeze([]),
        });
    let statements = planStatementBody(body, scope, context, loopFlowContext(Object.freeze([])));
    if (statements !== undefined && selection.binding.kind === "pattern") {
      const projected = planMojoBindingProjection(
        selection.binding.projection,
        mojoValue(Object.freeze({ kind: "path", path: selection.binding.name })),
        "direct",
        context,
        planMojoValue,
      );
      if (projected === undefined) return undefined;
      statements = Object.freeze([...projected, ...statements]);
    }
    if (statements !== undefined) {
      const bindingKind = ast.variableDeclarationKind(selection.binding.declaration);
      if (bindingKind === "using" || bindingKind === "await using") {
        statements = planMojoResourceScope(selection.binding.declaration, statements, context);
      }
    }
    const compileTime = isMojoCompileTimeIteration(selection.iterable, context);
    return statements === undefined
      ? undefined
      : Object.freeze([...sourceIterable.before, {
          kind: "for",
          binding: selection.binding.name,
          iterable,
          statements,
          ...(compileTime ? { compileTime: true } : {}),
        }]);
  }
  if (ast.is.IsSwitchStatement(node)) {
    return planMojoSwitchStatement(node, scope, context, flow, planStatementNodes);
  }
  if (ast.is.IsTryStatement(node)) {
    const tryBlock = TryStatement_TryBlock(ast, node);
    const catchClause = TryStatement_CatchClause(ast, node);
    const finallyBlock = TryStatement_FinallyBlock(ast, node);
    const tryContext = catchClause === undefined
      ? context
      : withMojoErrorType(context, context.program.queries.catchErrorType(catchClause));
    const tryStatements = tryBlock === undefined ? undefined : planBlock(tryBlock, scope, tryContext, flow);
    const catchBlock = CatchClause_Block(ast, catchClause);
    const catchStatements = catchBlock === undefined ? undefined : planBlock(catchBlock, scope, context, flow);
    const finallyStatements = finallyBlock === undefined ? undefined : planBlock(finallyBlock, scope, context, flow);
    if (tryStatements === undefined || (catchBlock !== undefined && catchStatements === undefined) ||
      (finallyBlock !== undefined && finallyStatements === undefined)) return undefined;
    const catchDeclaration = CatchClause_VariableDeclaration(ast, catchClause);
    const catchName = catchDeclaration === undefined ? undefined : context.program.queries.bindingName(catchDeclaration);
    if (catchDeclaration !== undefined && catchName === undefined) return undefined;
    return Object.freeze([Object.freeze({
      kind: "try",
      statements: tryStatements,
      catches: catchStatements === undefined
        ? Object.freeze([])
        : Object.freeze([Object.freeze({
            ...(catchName === undefined ? {} : { name: catchName }),
            statements: catchStatements,
          })]),
      ...(finallyStatements === undefined ? {} : { finallyStatements }),
    })]);
  }
  if (ast.is.IsBreakStatement(node)) return Object.freeze([{ kind: "break" }]);
  if (ast.is.IsContinueStatement(node)) {
    if (flow.continueStatements === undefined) return undefined;
    return flow.continueStatements;
  }
  appendMojoPlanningDiagnostic(
    context,
    "MOJO_SEALED_STATEMENT_PLAN_MISSING",
    `Statement kind '${ast.kindName(node)}' reached planning without its sealed Mojo form.`,
    node,
  );
  return undefined;
}

function mojoIterationMethod(
  target: Exclude<MojoIterationSelection["target"], "native-values">,
): string {
  switch (target) {
    case "dictionary-keys": return "keys";
    case "js-map-entries": return "iter_entries";
    case "js-array-values":
    case "js-set-values":
    case "js-string-values": return "iter_values";
  }
}

function planStatementNodes(
  nodes: readonly (Node | undefined)[],
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  return planStatementSequence(nodes, scope, context, flow);
}

function loopFlowContext(prefix: readonly MojoStatement[]): MojoFlowPlanningContext {
  return Object.freeze({
    continueStatements: Object.freeze([...prefix, Object.freeze({ kind: "continue" as const })]),
  });
}

function planStatementBody(
  node: Node,
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  return context.program.source.ast.is.IsBlock(node)
    ? planBlock(node, scope, context, flow)
    : planStatement(node, scope, context, flow);
}
