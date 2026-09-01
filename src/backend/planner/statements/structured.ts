import type { Node } from "@tsonic/tsts";
import {
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  DoStatement_Statement,
  ForInOrOfStatement_Statement,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IterationStatement_Statement,
  Node_Expression,
  Node_Initializer,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
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
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { allocateMojoSyntheticName, appendMojoPlanningDiagnostic } from "../program/context.js";
import { planMojoAssignment, planMojoValue, planMojoUpdate } from "../expressions/value.js";
import { registerMojoTypeImports } from "../types/render.js";
import { planMojoBindingPattern } from "../bindings/patterns.js";
import { planDiscardedMojoExpression } from "./discarded-expression.js";
import { planForIncrement } from "./for-increment.js";
import { planMojoResourceScope } from "./resources.js";

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

interface MojoStatementPlanningScope {
  readonly resultType?: MojoTargetTypeRef;
  readonly returnAllowed: boolean;
  readonly omittedStatements?: ReadonlySet<Node>;
}

interface MojoFlowPlanningContext {
  readonly continueStatements?: readonly MojoStatement[];
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
    const planned = planStatement(sourceStatement, scope, context, flow);
    if (planned === undefined) return undefined;
    statements.push(...planned);
  }
  return Object.freeze(statements);
}

function resourceDeclarationList(
  statement: Node,
  context: MojoPlanningContext,
): Node | undefined {
  const { ast } = context.program.source;
  if (!ast.is.IsVariableStatement(statement)) return undefined;
  const list = VariableStatement_DeclarationList(ast, statement);
  const kind = ast.variableDeclarationKind(list);
  return kind === "using" || kind === "await using" ? list : undefined;
}

function planResourceDeclarations(
  declarations: readonly Node[],
  continuation: readonly MojoStatement[],
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  let protectedStatements = continuation;
  for (let index = declarations.length - 1; index >= 0; index -= 1) {
    const declaration = declarations[index]!;
    const acquisition = planVariableDeclaration(declaration, context);
    const scope = planMojoResourceScope(declaration, protectedStatements, context);
    if (acquisition === undefined || scope === undefined) return undefined;
    protectedStatements = Object.freeze([...acquisition, ...scope]);
  }
  return protectedStatements;
}

function planStatement(
  node: Node,
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
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
      : context.program.queries.returnValueTransfer(sourceExpression!)
        ? Object.freeze({ kind: "consume" as const, expression: expression.value })
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
      : planMojoAssignment(sourceExpression, context);
    if (assignment !== undefined) {
      return Object.freeze([
        ...assignment.before,
        assignment.statement,
      ]);
    }
    const update = sourceExpression === undefined ? undefined : planMojoUpdate(sourceExpression, context);
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
    return expression === undefined
      ? undefined
      : Object.freeze([...expression.before, { kind: "raise", expression: expression.value }]);
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
      : planMojoValue(conditionNode, context, { kind: "source-primitive", name: "bool" });
    const thenStatements = thenNode === undefined ? undefined : planStatementBody(thenNode, scope, context, flow);
    const elseStatements = elseNode === undefined ? undefined : planStatementBody(elseNode, scope, context, flow);
    if (condition === undefined || thenStatements === undefined ||
      (elseNode !== undefined && elseStatements === undefined)) return undefined;
    return Object.freeze([...condition.before, {
      kind: "if",
      condition: condition.value,
      thenStatements,
      ...(elseStatements === undefined ? {} : { elseStatements }),
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
    if (statements !== undefined) {
      const bindingKind = ast.variableDeclarationKind(selection.bindingDeclaration);
      if (bindingKind === "using" || bindingKind === "await using") {
        statements = planMojoResourceScope(selection.bindingDeclaration, statements, context);
      }
    }
    return statements === undefined
      ? undefined
      : Object.freeze([...sourceIterable.before, { kind: "for", binding: selection.bindingName, iterable, statements }]);
  }
  if (ast.is.IsSwitchStatement(node)) {
    return planSwitchStatement(node, scope, context, flow);
  }
  if (ast.is.IsTryStatement(node)) {
    const tryBlock = TryStatement_TryBlock(ast, node);
    const catchClause = TryStatement_CatchClause(ast, node);
    const finallyBlock = TryStatement_FinallyBlock(ast, node);
    const tryStatements = tryBlock === undefined ? undefined : planBlock(tryBlock, scope, context, flow);
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
    "MOJO_STATEMENT_PLAN_UNSUPPORTED",
    `Statement kind '${ast.kindName(node)}' reached planning without a Mojo form.`,
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

function planSwitchStatement(
  node: Node,
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  const discriminantNode = SwitchStatement_Expression(ast, node);
  const discriminantType = discriminantNode === undefined
    ? undefined
    : context.program.queries.expressionType(discriminantNode);
  const discriminant = discriminantNode === undefined
    ? undefined
    : planMojoValue(discriminantNode, context);
  const clauses = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, node));
  if (discriminant === undefined || discriminantType === undefined || clauses === undefined ||
    clauses.some((clause) => clause === undefined)) return undefined;
  registerMojoTypeImports(discriminantType, context);
  const discriminantName = allocateMojoSyntheticName(context, "switch_value");
  const selectedName = allocateMojoSyntheticName(context, "switch_clause");
  const continueName = flow.continueStatements === undefined
    ? undefined
    : allocateMojoSyntheticName(context, "switch_continue");
  const discriminantPath: MojoExpression = Object.freeze({ kind: "path", path: discriminantName });
  const selectedPath: MojoExpression = Object.freeze({ kind: "path", path: selectedName });
  const before: MojoStatement[] = [
    ...discriminant.before,
    Object.freeze({
      kind: "variable",
      name: discriminantName,
      type: discriminantType,
      initializer: discriminant.value,
    }),
    Object.freeze({
      kind: "variable",
      name: selectedName,
      type: Object.freeze({ kind: "source-primitive", name: "native-int" }),
      initializer: Object.freeze({ kind: "number-literal", text: "-1" }),
    }),
  ];
  let defaultIndex: number | undefined;
  for (const [index, clause] of (clauses as readonly Node[]).entries()) {
    const caseNode = CaseOrDefaultClause_Expression(ast, clause);
    if (caseNode === undefined) {
      if (defaultIndex !== undefined) return undefined;
      defaultIndex = index;
      continue;
    }
    const caseValue = planMojoValue(caseNode, context, discriminantType);
    if (caseValue === undefined) return undefined;
    before.push(Object.freeze({
      kind: "if",
      condition: selectedEquals(selectedPath, -1),
      thenStatements: Object.freeze([
        ...caseValue.before,
        Object.freeze({
          kind: "if",
          condition: Object.freeze({
            kind: "binary",
            operator: "==",
            left: discriminantPath,
            right: caseValue.value,
          }),
          thenStatements: Object.freeze([Object.freeze({
            kind: "assignment",
            operator: "=",
            left: selectedPath,
            right: Object.freeze({ kind: "number-literal", text: String(index) }),
          })]),
        }),
      ]),
    }));
  }
  if (defaultIndex !== undefined) {
    before.push(Object.freeze({
      kind: "if",
      condition: selectedEquals(selectedPath, -1),
      thenStatements: Object.freeze([Object.freeze({
        kind: "assignment",
        operator: "=",
        left: selectedPath,
        right: Object.freeze({ kind: "number-literal", text: String(defaultIndex) }),
      })]),
    }));
  }
  if (continueName !== undefined) {
    before.push(Object.freeze({
      kind: "variable",
      name: continueName,
      type: Object.freeze({ kind: "source-primitive", name: "bool" }),
      initializer: Object.freeze({ kind: "bool-literal", value: false }),
    }));
  }
  const switchContinue: readonly MojoStatement[] | undefined = continueName === undefined
    ? undefined
    : Object.freeze([
        Object.freeze({
          kind: "assignment",
          operator: "=",
          left: Object.freeze({ kind: "path", path: continueName }),
          right: Object.freeze({ kind: "bool-literal", value: true }),
        }),
        Object.freeze({ kind: "break" }),
      ]);
  const clauseStatements: MojoStatement[] = [];
  for (const [index, clause] of (clauses as readonly Node[]).entries()) {
    const statements = planStatementNodes(
      CaseOrDefaultClause_Statements(ast, clause) ?? [],
      scope,
      context,
      Object.freeze({ continueStatements: switchContinue }),
    );
    if (statements === undefined) return undefined;
    clauseStatements.push(Object.freeze({
      kind: "if",
      condition: Object.freeze({
        kind: "binary",
        operator: "and",
        left: Object.freeze({
          kind: "binary",
          operator: ">=",
          left: selectedPath,
          right: Object.freeze({ kind: "number-literal", text: "0" }),
        }),
        right: Object.freeze({
          kind: "binary",
          operator: "<=",
          left: selectedPath,
          right: Object.freeze({ kind: "number-literal", text: String(index) }),
        }),
      }),
      thenStatements: statements,
    }));
  }
  before.push(Object.freeze({
    kind: "while",
    condition: Object.freeze({ kind: "bool-literal", value: true }),
    statements: Object.freeze([...clauseStatements, Object.freeze({ kind: "break" as const })]),
  }));
  if (continueName !== undefined && flow.continueStatements !== undefined) {
    before.push(Object.freeze({
      kind: "if",
      condition: Object.freeze({ kind: "path", path: continueName }),
      thenStatements: flow.continueStatements,
    }));
  }
  return Object.freeze(before);
}

function planStatementNodes(
  nodes: readonly (Node | undefined)[],
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
): readonly MojoStatement[] | undefined {
  return planStatementSequence(nodes, scope, context, flow);
}

function initializerResourceDeclarationList(
  initializer: Node | undefined,
  context: MojoPlanningContext,
): Node | undefined {
  if (initializer === undefined ||
    !context.program.source.ast.is.IsVariableDeclarationList(initializer)) return undefined;
  const kind = context.program.source.ast.variableDeclarationKind(initializer);
  return kind === "using" || kind === "await using" ? initializer : undefined;
}

function selectedEquals(selected: MojoExpression, value: number): MojoExpression {
  return Object.freeze({
    kind: "binary",
    operator: "==",
    left: selected,
    right: Object.freeze({ kind: "number-literal", text: String(value) }),
  });
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
    const selected = planVariableDeclaration(declaration, context);
    if (selected === undefined) return undefined;
    planned.push(...selected);
  }
  return Object.freeze(planned);
}

function planVariableDeclaration(
  declaration: Node,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
    const { ast } = context.program.source;
    const pattern = context.program.queries.bindingPatternSelection(declaration);
    if (pattern !== undefined) {
      const statements = planMojoBindingPattern(pattern, context, planMojoValue);
      if (statements === undefined) return undefined;
      return statements;
    }
    const name = context.program.queries.bindingName(declaration);
    const type = context.program.queries.bindingType(declaration);
    const sourceInitializer = Node_Initializer(ast, declaration);
    if (name === undefined || type === undefined || sourceInitializer === undefined) return undefined;
    const initializer = planMojoValue(sourceInitializer, context, type);
    if (initializer === undefined) return undefined;
    const locationStorage = context.program.queries.locationStorage(declaration);
    if (locationStorage === undefined) {
      registerMojoTypeImports(type, context);
      return Object.freeze([...initializer.before, { kind: "variable", name, type, initializer: initializer.value }]);
    } else {
      const locationType: MojoTargetTypeRef = Object.freeze({
        kind: "target-named",
        id: "tsonic.mojo.runtime.Location",
        modulePath: Object.freeze(["tsonic_runtime"]),
        name: "Location",
        genericArguments: Object.freeze([Object.freeze({ kind: "type", type })]),
      });
      registerMojoTypeImports(locationType, context);
      return Object.freeze([...initializer.before, {
        kind: "variable",
        name: locationStorage.name,
        type: locationType,
        initializer: Object.freeze({
          kind: "construct",
          type: locationType,
          arguments: Object.freeze([Object.freeze({ value: initializer.value })]),
        }),
      }]);
    }
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
  if (assignment !== undefined) return Object.freeze([
    ...assignment.before,
    assignment.statement,
  ]);
  const update = planMojoUpdate(initializer, context);
  if (update !== undefined) return Object.freeze([
    ...update.before,
    update.statement,
  ]);
  const expression = planMojoValue(initializer, context);
  return expression === undefined
    ? undefined
    : Object.freeze([...expression.before, { kind: "expression", expression: expression.value }]);
}
