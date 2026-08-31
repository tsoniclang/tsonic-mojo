import type { MojoExpression, MojoFunctionDeclaration, MojoSourceModule, MojoStatement } from "../target-ast/nodes.js";
import { mojoTypeName } from "../planner/types/render.js";

export function printMojoModule(module: MojoSourceModule): string {
  const lines: string[] = [];
  for (const importPath of module.imports) {
    if (importPath === "std.collections.List") lines.push("from std.collections import List");
    else if (importPath === "std.collections.Optional") lines.push("from std.collections import Optional");
    else lines.push(`import ${importPath}`);
  }
  if (lines.length > 0 && module.functions.length > 0) lines.push("");
  for (const [index, function_] of module.functions.entries()) {
    lines.push(...printFunction(function_));
    if (index + 1 < module.functions.length) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function printFunction(function_: MojoFunctionDeclaration): string[] {
  const parameters = function_.parameters
    .map((parameter) => `${parameter.name}: ${requiredTypeName(parameter.type)}`)
    .join(", ");
  const result = mojoTypeName(function_.resultType);
  const signature = `def ${function_.name}(${parameters})${function_.raises ? " raises" : ""}${result === undefined ? "" : ` -> ${result}`}:`;
  const body = function_.statements.length === 0
    ? ["    pass"]
    : function_.statements.flatMap((statement) => printStatement(statement, 1));
  return [signature, ...body];
}

function printStatement(statement: MojoStatement, depth: number): string[] {
  const indent = "    ".repeat(depth);
  switch (statement.kind) {
    case "return": return [`${indent}return${statement.expression === undefined ? "" : ` ${printExpression(statement.expression)}`}`];
    case "variable": return [`${indent}var ${statement.name}: ${requiredTypeName(statement.type)} = ${printExpression(statement.initializer)}`];
    case "assignment": return [`${indent}${printExpression(statement.left)} ${statement.operator} ${printExpression(statement.right)}`];
    case "expression": return [`${indent}${printExpression(statement.expression)}`];
    case "if": {
      const lines = [`${indent}if ${printExpression(statement.condition)}:`, ...printBody(statement.thenStatements, depth + 1)];
      if (statement.elseStatements !== undefined) {
        lines.push(`${indent}else:`, ...printBody(statement.elseStatements, depth + 1));
      }
      return lines;
    }
    case "while": return [`${indent}while ${printExpression(statement.condition)}:`, ...printBody(statement.statements, depth + 1)];
  }
}

function printBody(statements: readonly MojoStatement[], depth: number): string[] {
  return statements.length === 0
    ? [`${"    ".repeat(depth)}pass`]
    : statements.flatMap((statement) => printStatement(statement, depth));
}

function printExpression(expression: MojoExpression): string {
  switch (expression.kind) {
    case "path": return expression.path;
    case "string-literal": return quoteMojoString(expression.value);
    case "number-literal": return expression.text;
    case "bool-literal": return expression.value ? "True" : "False";
    case "binary": return `(${printExpression(expression.left)} ${expression.operator} ${printExpression(expression.right)})`;
    case "call": return `${printExpression(expression.callee)}(${expression.arguments.map(printExpression).join(", ")})`;
    case "method-call": return `${printExpression(expression.receiver)}.${expression.name}(${expression.arguments.map(printExpression).join(", ")})`;
    case "member": return `${printExpression(expression.receiver)}.${expression.name}`;
    case "construct": return `${requiredTypeName(expression.type)}(${expression.arguments.map(printExpression).join(", ")})`;
    case "consume": return `${printExpression(expression.expression)}^`;
    case "parenthesized": return `(${printExpression(expression.expression)})`;
  }
}

function requiredTypeName(type: Parameters<typeof mojoTypeName>[0]): string {
  const name = mojoTypeName(type);
  if (name === undefined) throw new Error("A value position cannot use the Mojo unit type.");
  return name;
}

function quoteMojoString(value: string): string {
  return JSON.stringify(value).replace(/\\u2028/gu, "\\u{2028}").replace(/\\u2029/gu, "\\u{2029}");
}
