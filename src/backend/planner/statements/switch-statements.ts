import type { Node } from "@tsonic/tsts";
import {
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
} from "@tsonic/target-api/source";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { allocateMojoSyntheticName } from "../program/context.js";
import { planMojoValue } from "../expressions/value.js";
import { registerMojoTypeImports } from "../types/imports.js";
import type {
  MojoFlowPlanningContext,
  MojoStatementPlanningScope,
} from "./statement-planning-model.js";

export type MojoNestedStatementPlanner = (
  nodes: readonly (Node | undefined)[],
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
) => readonly MojoStatement[] | undefined;

export function planMojoSwitchStatement(
  node: Node,
  scope: MojoStatementPlanningScope,
  context: MojoPlanningContext,
  flow: MojoFlowPlanningContext,
  planStatements: MojoNestedStatementPlanner,
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
    const statements = planStatements(
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

function selectedEquals(selected: MojoExpression, value: number): MojoExpression {
  return Object.freeze({
    kind: "binary",
    operator: "==",
    left: selected,
    right: Object.freeze({ kind: "number-literal", text: String(value) }),
  });
}
