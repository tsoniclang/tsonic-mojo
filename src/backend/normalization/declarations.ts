import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoStatement,
} from "../target-ast/index.js";
import { normalizeMojoExpression, normalizeMojoParameter } from "./expressions.js";

export function normalizeMojoDeclarations(
  declarations: readonly MojoDeclaration[],
): readonly MojoDeclaration[] {
  return Object.freeze(declarations.map(normalizeDeclaration));
}

function normalizeDeclaration(declaration: MojoDeclaration): MojoDeclaration {
  switch (declaration.kind) {
    case "function": return normalizeFunction(declaration);
    case "struct": return Object.freeze({
      ...declaration,
      fields: Object.freeze(declaration.fields.map((field) => Object.freeze({
        ...field,
        ...(field.initializer === undefined
          ? {}
          : { initializer: normalizeMojoExpression(field.initializer) }),
      }))),
      methods: Object.freeze(declaration.methods.map(normalizeFunction)),
    });
    case "trait": return Object.freeze({
      ...declaration,
      methods: Object.freeze(declaration.methods.map(normalizeFunction)),
    });
    case "type-alias":
      return declaration;
    case "comptime": return Object.freeze({
      ...declaration,
      initializer: normalizeMojoExpression(declaration.initializer),
    });
  }
}

function normalizeFunction(
  declaration: MojoFunctionDeclaration,
): MojoFunctionDeclaration {
  return Object.freeze({
      ...declaration,
      parameters: Object.freeze(declaration.parameters.map(normalizeMojoParameter)),
      ...(declaration.statements === undefined
        ? {}
        : { statements: normalizeMojoStatements(declaration.statements) }),
    });
}

export function normalizeMojoStatements(
  statements: readonly MojoStatement[],
): readonly MojoStatement[] {
  const normalized: MojoStatement[] = [];
  for (let index = 0; index < statements.length; index += 1) {
    const source = statements[index]!;
    const next = statements[index + 1];
    if (source.kind === "variable" && source.initializer === undefined &&
      next?.kind === "assignment" && next.operator === "=" &&
      next.left.kind === "path" && next.left.path === source.name) {
      normalized.push(normalizeStatement(Object.freeze({ ...source, initializer: next.right })));
      index += 1;
      continue;
    }
    const statement = normalizeStatement(source);
    if (isEmptyUnitExpression(statement) || isPureUnusedLiteral(statement)) continue;
    normalized.push(statement);
    if (terminatesBlock(statement)) break;
  }
  return Object.freeze(normalized);
}

function normalizeStatement(statement: MojoStatement): MojoStatement {
  switch (statement.kind) {
    case "if": return Object.freeze({
      ...statement,
      condition: normalizeMojoExpression(statement.condition),
      thenStatements: normalizeMojoStatements(statement.thenStatements),
      ...(statement.elseStatements === undefined
        ? {}
        : { elseStatements: normalizeMojoStatements(statement.elseStatements) }),
    });
    case "while": return Object.freeze({
      ...statement,
      condition: normalizeMojoExpression(statement.condition),
      statements: normalizeMojoStatements(statement.statements),
    });
    case "for": return Object.freeze({
      ...statement,
      iterable: normalizeMojoExpression(statement.iterable),
      statements: normalizeMojoStatements(statement.statements),
    });
    case "with": return Object.freeze({
      ...statement,
      expression: normalizeMojoExpression(statement.expression),
      statements: normalizeMojoStatements(statement.statements),
    });
    case "try": return Object.freeze({
      ...statement,
      statements: normalizeMojoStatements(statement.statements),
      catches: Object.freeze(statement.catches.map((catch_) => Object.freeze({
        ...catch_,
        statements: normalizeMojoStatements(catch_.statements),
      }))),
      ...(statement.finallyStatements === undefined
        ? {}
        : { finallyStatements: normalizeMojoStatements(statement.finallyStatements) }),
    });
    case "return":
    case "raise": return statement.expression === undefined
      ? statement
      : Object.freeze({ ...statement, expression: normalizeMojoExpression(statement.expression) });
    case "variable": return statement.initializer === undefined
      ? statement
      : Object.freeze({ ...statement, initializer: normalizeMojoExpression(statement.initializer) });
    case "tuple-variable": return Object.freeze({
      ...statement,
      initializer: normalizeMojoExpression(statement.initializer),
    });
    case "assignment": return Object.freeze({
      ...statement,
      left: normalizeMojoExpression(statement.left),
      right: normalizeMojoExpression(statement.right),
    });
    case "expression":
    case "discard": return Object.freeze({
      ...statement,
      expression: normalizeMojoExpression(statement.expression),
    });
    case "break":
    case "continue":
    case "pass": return statement;
  }
}

function isEmptyUnitExpression(statement: MojoStatement): boolean {
  return (statement.kind === "expression" || statement.kind === "discard") &&
    statement.expression.kind === "tuple" &&
    statement.expression.elements.length === 0;
}

function isPureUnusedLiteral(statement: MojoStatement): boolean {
  return statement.kind === "discard" &&
    (statement.expression.kind === "number-literal" ||
      statement.expression.kind === "bool-literal" ||
      statement.expression.kind === "none-literal");
}

function terminatesBlock(statement: MojoStatement): boolean {
  if (statement.kind === "return" || statement.kind === "raise" ||
    statement.kind === "break" || statement.kind === "continue") return true;
  if (statement.kind !== "if" || statement.elseStatements === undefined) return false;
  return branchTerminates(statement.thenStatements) && branchTerminates(statement.elseStatements);
}

function branchTerminates(statements: readonly MojoStatement[]): boolean {
  const last = statements[statements.length - 1];
  return last !== undefined && terminatesBlock(last);
}
