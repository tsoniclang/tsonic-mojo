import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoStatement,
} from "../target-ast/index.js";

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
      methods: Object.freeze(declaration.methods.map(normalizeFunction)),
    });
    case "trait":
    case "type-alias":
    case "comptime": return declaration;
  }
}

function normalizeFunction(
  declaration: MojoFunctionDeclaration,
): MojoFunctionDeclaration {
  return declaration.statements === undefined
    ? declaration
    : Object.freeze({
        ...declaration,
        statements: normalizeMojoStatements(declaration.statements),
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
      normalized.push(Object.freeze({ ...source, initializer: next.right }));
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
      thenStatements: normalizeMojoStatements(statement.thenStatements),
      ...(statement.elseStatements === undefined
        ? {}
        : { elseStatements: normalizeMojoStatements(statement.elseStatements) }),
    });
    case "while":
    case "for":
    case "with": return Object.freeze({
      ...statement,
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
    default: return statement;
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
