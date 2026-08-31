import type {
  MojoCallArgument,
  MojoDeclaration,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoParameter,
  MojoSourceModule,
  MojoStatement,
  MojoStructDeclaration,
  MojoTraitDeclaration,
} from "../target-ast/nodes.js";
import { mojoGenericParametersText, mojoTypeName } from "../planner/types/render.js";

export function printMojoModule(module: MojoSourceModule): string {
  const lines = module.imports.map(printImport);
  if (lines.length > 0 && module.declarations.length > 0) lines.push("");
  for (const [index, declaration] of module.declarations.entries()) {
    lines.push(...printDeclaration(declaration));
    if (index + 1 < module.declarations.length) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function printImport(import_: MojoSourceModule["imports"][number]): string {
  const path = import_.modulePath.join(".");
  if (import_.kind === "module") {
    return `import ${path}${import_.alias === undefined ? "" : ` as ${import_.alias}`}`;
  }
  return `from ${path} import ${import_.symbols.map((symbol) =>
    `${symbol.name}${symbol.alias === undefined ? "" : ` as ${symbol.alias}`}`).join(", ")}`;
}

function printDeclaration(declaration: MojoDeclaration): string[] {
  switch (declaration.kind) {
    case "function": return printFunction(declaration, 0);
    case "struct": return printStruct(declaration);
    case "trait": return printTrait(declaration);
    case "type-alias": return [
      `comptime ${declaration.name}${mojoGenericParametersText(declaration.genericParameters)} = ${
        requiredTypeName(declaration.value)
      }`,
    ];
    case "comptime": {
      const type = declaration.type === undefined ? "" : `: ${requiredTypeName(declaration.type)}`;
      return [`comptime ${declaration.name}${mojoGenericParametersText(declaration.genericParameters)}${type} = ${
        printExpression(declaration.initializer)
      }`];
    }
    case "module-variable": {
      const type = declaration.type === undefined ? "" : `: ${requiredTypeName(declaration.type)}`;
      return [`var ${declaration.name}${type} = ${printExpression(declaration.initializer)}`];
    }
  }
}

function printFunction(function_: MojoFunctionDeclaration, depth: number): string[] {
  const indent = "    ".repeat(depth);
  const decorators = (function_.decorators ?? []).map((decorator) => `${indent}@${decorator}`);
  const parameters = function_.parameters.map(printParameter).join(", ");
  const result = mojoTypeName(function_.resultType);
  const signature = `${indent}${function_.asynchronous ? "async " : ""}def ${function_.name}${
    mojoGenericParametersText(function_.genericParameters)
  }(${parameters})${function_.raises ? " raises" : ""}${result === undefined ? "" : ` -> ${result}`}:`;
  const body = function_.statements === undefined
    ? [`${indent}    ...`]
    : printBody(function_.statements, depth + 1);
  return [...decorators, signature, ...body];
}

function printStruct(declaration: MojoStructDeclaration): string[] {
  const decorators = (declaration.decorators ?? []).map((decorator) => `@${decorator}`);
  const conformances = declaration.conformances.length === 0
    ? ""
    : `(${declaration.conformances.map(requiredTypeName).join(", ")})`;
  const lines = [...decorators, `struct ${declaration.name}${
    mojoGenericParametersText(declaration.genericParameters)
  }${conformances}:`];
  for (const field of declaration.fields) {
    lines.push(`    ${field.compileTime ? "comptime" : "var"} ${field.name}: ${requiredTypeName(field.type)}${
      field.initializer === undefined ? "" : ` = ${printExpression(field.initializer)}`
    }`);
  }
  for (const [index, method] of declaration.methods.entries()) {
    if (declaration.fields.length > 0 || index > 0) lines.push("");
    lines.push(...printFunction(method, 1));
  }
  if (declaration.fields.length === 0 && declaration.methods.length === 0) lines.push("    pass");
  return lines;
}

function printTrait(declaration: MojoTraitDeclaration): string[] {
  const parents = declaration.parents.length === 0
    ? ""
    : `(${declaration.parents.map(requiredTypeName).join(", ")})`;
  const lines = [`trait ${declaration.name}${parents}:`];
  for (const [index, method] of declaration.methods.entries()) {
    if (index > 0) lines.push("");
    lines.push(...printFunction({ ...method, statements: undefined }, 1));
  }
  if (declaration.methods.length === 0) lines.push("    pass");
  return lines;
}

function printParameter(parameter: MojoParameter): string {
  const convention = parameter.convention === undefined || parameter.convention === "imm"
    ? ""
    : `${parameter.convention} `;
  const variadic = parameter.variadic === true ? "*" : "";
  return `${convention}${variadic}${parameter.name}: ${requiredTypeName(parameter.type)}${
    parameter.defaultValue === undefined ? "" : ` = ${printExpression(parameter.defaultValue)}`
  }`;
}

function printStatement(statement: MojoStatement, depth: number): string[] {
  const indent = "    ".repeat(depth);
  switch (statement.kind) {
    case "return": return [`${indent}return${statement.expression === undefined ? "" : ` ${printExpression(statement.expression)}`}`];
    case "variable": {
      const type = statement.type === undefined ? "" : `: ${requiredTypeName(statement.type)}`;
      const initializer = statement.initializer === undefined ? "" : ` = ${printExpression(statement.initializer)}`;
      return [`${indent}var ${statement.name}${type}${initializer}`];
    }
    case "assignment": return [`${indent}${printExpression(statement.left)} ${statement.operator} ${printExpression(statement.right)}`];
    case "expression": return [`${indent}${printExpression(statement.expression)}`];
    case "if": {
      const lines = [`${indent}if ${printExpression(statement.condition)}:`, ...printBody(statement.thenStatements, depth + 1)];
      if (statement.elseStatements !== undefined) lines.push(`${indent}else:`, ...printBody(statement.elseStatements, depth + 1));
      return lines;
    }
    case "while": return [`${indent}while ${printExpression(statement.condition)}:`, ...printBody(statement.statements, depth + 1)];
    case "for": return [`${indent}for ${statement.binding} in ${printExpression(statement.iterable)}:`, ...printBody(statement.statements, depth + 1)];
    case "break": return [`${indent}break`];
    case "continue": return [`${indent}continue`];
    case "pass": return [`${indent}pass`];
    case "raise": return [`${indent}raise${statement.expression === undefined ? "" : ` ${printExpression(statement.expression)}`}`];
    case "try": {
      const lines = [`${indent}try:`, ...printBody(statement.statements, depth + 1)];
      for (const catch_ of statement.catches) {
        lines.push(`${indent}except${catch_.name === undefined ? "" : ` ${catch_.name}`}:`, ...printBody(catch_.statements, depth + 1));
      }
      if (statement.finallyStatements !== undefined) lines.push(`${indent}finally:`, ...printBody(statement.finallyStatements, depth + 1));
      return lines;
    }
    case "with": return [
      `${indent}with ${printExpression(statement.expression)}${statement.binding === undefined ? "" : ` as ${statement.binding}`}:`,
      ...printBody(statement.statements, depth + 1),
    ];
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
    case "none-literal": return "None";
    case "tuple": return `(${expression.elements.map(printExpression).join(", ")}${expression.elements.length === 1 ? "," : ""})`;
    case "list": return `[${expression.elements.map(printExpression).join(", ")}]`;
    case "dictionary": return `{${expression.entries.map((entry) => `${printExpression(entry.key)}: ${printExpression(entry.value)}`).join(", ")}}`;
    case "unary": return `${expression.operator}${/^[A-Za-z]/u.test(expression.operator) ? " " : ""}${printExpression(expression.operand)}`;
    case "binary": return `(${printExpression(expression.left)} ${expression.operator} ${printExpression(expression.right)})`;
    case "conditional": return `(${printExpression(expression.whenTrue)} if ${printExpression(expression.condition)} else ${printExpression(expression.whenFalse)})`;
    case "call": return `${printExpression(expression.callee)}${printCallGenericArguments(expression.genericArguments)}(${expression.arguments.map(printCallArgument).join(", ")})`;
    case "method-call": return `${printExpression(expression.receiver)}.${expression.name}${printCallGenericArguments(expression.genericArguments)}(${expression.arguments.map(printCallArgument).join(", ")})`;
    case "member": return `${printExpression(expression.receiver)}.${expression.name}`;
    case "element": return `${printExpression(expression.receiver)}[${printExpression(expression.index)}]`;
    case "slice": return `${printExpression(expression.receiver)}[${expression.start === undefined ? "" : printExpression(expression.start)}:${expression.end === undefined ? "" : printExpression(expression.end)}${expression.step === undefined ? "" : `:${printExpression(expression.step)}`}]`;
    case "construct": return `${requiredTypeName(expression.type)}${printCallGenericArguments(expression.genericArguments)}(${expression.arguments.map(printCallArgument).join(", ")})`;
    case "consume": return `${printExpression(expression.expression)}^`;
    case "await": return `await ${printExpression(expression.expression)}`;
    case "parenthesized": return `(${printExpression(expression.expression)})`;
    case "lambda": return `lambda (${expression.parameters.map(printParameter).join(", ")}): ${printExpression(expression.expression)}`;
  }
}

function printCallGenericArguments(
  arguments_: readonly import("../../target-model/provider/model.js").MojoTargetGenericArgument[] | undefined,
): string {
  return arguments_ === undefined || arguments_.length === 0
    ? ""
    : `[${arguments_.map(renderCallGenericArgument).join(", ")}]`;
}

function renderCallGenericArgument(
  argument: import("../../target-model/provider/model.js").MojoTargetGenericArgument,
): string {
  const value = argument.kind === "type"
    ? requiredTypeName(argument.type)
    : argument.kind === "unbound"
      ? "_"
      : argument.expression;
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

function printCallArgument(argument: MojoCallArgument): string {
  const value = `${argument.spread === true ? "*" : ""}${printExpression(argument.value)}`;
  return argument.name === undefined ? value : `${argument.name}=${value}`;
}

function requiredTypeName(type: Parameters<typeof mojoTypeName>[0]): string {
  const name = mojoTypeName(type);
  if (name === undefined) throw new Error("A value position cannot use the Mojo unit type.");
  return name;
}

function quoteMojoString(value: string): string {
  return JSON.stringify(value).replace(/\\u2028/gu, "\\u{2028}").replace(/\\u2029/gu, "\\u{2029}");
}
