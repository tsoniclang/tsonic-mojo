import type {
  MojoCallArgument,
  MojoExpression,
  MojoLambdaCapture,
  MojoParameter,
} from "../../backend/target-ast/index.js";
import {
  chooseLayout,
  concat,
  delimitedList,
  emptyDocument,
  group,
  hardLine,
  ifBreak,
  indent,
  join,
  line,
  text,
} from "../document/builders.js";
import type { MojoDocument } from "../document/model.js";
import type { MojoPrintContext } from "./context.js";
import {
  printGenericArguments,
  printMojoGenericArgumentValueDocument,
  printMojoTypeDocument,
  requiredMojoTypeDocument,
} from "./types.js";

const conditionalPrecedence = 10;
const lambdaPrecedence = 5;
const unaryPrecedence = 90;
const postfixPrecedence = 100;
const atomPrecedence = 110;

export function printMojoExpressionDocument(
  expression: MojoExpression,
  context: MojoPrintContext,
  parentPrecedence = 0,
): MojoDocument {
  const precedence = expressionPrecedence(expression);
  const result = printExpressionAtPrecedence(expression, context, precedence);
  return precedence < parentPrecedence
    ? concat(text("("), result, text(")"))
    : result;
}

function printExpressionAtPrecedence(
  expression: MojoExpression,
  context: MojoPrintContext,
  precedence: number,
): MojoDocument {
  switch (expression.kind) {
    case "path": {
      if (expression.path.includes(".")) {
        throw new Error(`Local Mojo path '${expression.path}' contains embedded qualification.`);
      }
      return text(expression.path);
    }
    case "qualified-path": return text(renderQualifiedPath(expression.segments, context));
    case "type-value": return requiredMojoTypeDocument(expression.type, context);
    case "string-literal": return text(quoteMojoString(expression.value));
    case "number-literal": return text(expression.text);
    case "bool-literal": return text(expression.value ? "True" : "False");
    case "none-literal": return text("None");
    case "tuple": {
      const elements = expression.elements.map((element) =>
        printMojoExpressionDocument(element, context));
      return elements.length === 1
        ? concat(text("("), elements[0]!, text(",)"))
        : delimitedList("(", elements, ")");
    }
    case "list": return delimitedList(
      "[",
      expression.elements.map((element) => printMojoExpressionDocument(element, context)),
      "]",
    );
    case "dictionary": return delimitedList(
      "{",
      expression.entries.map((entry) => group(concat(
        printMojoExpressionDocument(entry.key, context),
        text(":"),
        line,
        printMojoExpressionDocument(entry.value, context),
      ))),
      "}",
    );
    case "unary": return group(concat(
      text(expression.operator),
      /^[A-Za-z]/u.test(expression.operator) ? text(" ") : emptyDocument,
      printMojoExpressionDocument(expression.operand, context, unaryPrecedence),
    ));
    case "binary": return printBinaryDocument(expression, context, precedence);
    case "conditional": {
      const whenTrue = printMojoExpressionDocument(expression.whenTrue, context, conditionalPrecedence + 1);
      const condition = printMojoExpressionDocument(expression.condition, context, conditionalPrecedence + 1);
      const whenFalse = printMojoExpressionDocument(expression.whenFalse, context, conditionalPrecedence);
      return chooseLayout(
        concat(whenTrue, text(" if "), condition, text(" else "), whenFalse),
        parenthesizeWhenBroken(concat(whenTrue, line, text("if "), condition, line, text("else "), whenFalse)),
      );
    }
    case "call": return group(concat(
      printMojoExpressionDocument(expression.callee, context, postfixPrecedence),
      expression.genericArguments === undefined || expression.genericArguments.length === 0
        ? emptyDocument
        : printGenericArguments(expression.genericArguments, context),
      printCallArguments(expression.arguments, context),
    ));
    case "method-call": return group(concat(
      printMojoExpressionDocument(expression.receiver, context, postfixPrecedence),
      text(`.${expression.name}`),
      expression.genericArguments === undefined || expression.genericArguments.length === 0
        ? emptyDocument
        : printGenericArguments(expression.genericArguments, context),
      printCallArguments(expression.arguments, context),
    ));
    case "member": return concat(
      printMojoExpressionDocument(expression.receiver, context, postfixPrecedence),
      text(`.${expression.name}`),
    );
    case "element": return concat(
      printMojoExpressionDocument(expression.receiver, context, postfixPrecedence),
      text("["),
      printMojoExpressionDocument(expression.index, context),
      text("]"),
    );
    case "proven-union-member": return concat(
      printMojoExpressionDocument(expression.receiver, context, postfixPrecedence),
      text(".unsafe_get["),
      requiredMojoTypeDocument(expression.type, context),
      text("]()"),
    );
    case "slice": return concat(
      printMojoExpressionDocument(expression.receiver, context, postfixPrecedence),
      text("["),
      expression.start === undefined
        ? emptyDocument
        : printMojoExpressionDocument(expression.start, context),
      text(":"),
      expression.end === undefined
        ? emptyDocument
        : printMojoExpressionDocument(expression.end, context),
      expression.step === undefined
        ? emptyDocument
        : concat(text(":"), printMojoExpressionDocument(expression.step, context)),
      text("]"),
    );
    case "construct": {
      const argument = expression.arguments.length === 1 ? expression.arguments[0] : undefined;
      const scalarLiteral = expression.type.kind === "source-primitive" &&
        argument !== undefined && argument.name === undefined && argument.spread !== true &&
        (argument.value.kind === "number-literal" || argument.value.kind === "bool-literal" ||
          (argument.value.kind === "unary" && argument.value.operand.kind === "number-literal"));
      return group(concat(
        requiredMojoTypeDocument(expression.type, context),
        expression.genericArguments === undefined || expression.genericArguments.length === 0
          ? emptyDocument
          : printGenericArguments(expression.genericArguments, context),
        scalarLiteral
          ? concat(text("("), printMojoExpressionDocument(argument.value, context), text(")"))
          : printCallArguments(expression.arguments, context),
      ));
    }
    case "forced-comptime": return concat(
      text("comptime"),
      delimitedList("(", [printMojoExpressionDocument(expression.expression, context)], ")"),
    );
    case "generic-argument-value":
      return printMojoGenericArgumentValueDocument(expression.value, context);
    case "copy": return concat(
      printMojoExpressionDocument(expression.expression, context, postfixPrecedence),
      text(".copy()"),
    );
    case "materialize": return concat(
      text("materialize"),
      delimitedList("[", [printMojoExpressionDocument(expression.expression, context)], "]"),
      text("()"),
    );
    case "consume": return concat(
      printMojoExpressionDocument(expression.expression, context, postfixPrecedence),
      text("^"),
    );
    case "postfix-deref": return concat(
      printMojoExpressionDocument(expression.expression, context, postfixPrecedence),
      text("[]"),
    );
    case "await": return concat(
      text("await "),
      printMojoExpressionDocument(expression.expression, context, unaryPrecedence),
    );
    case "parenthesized": return concat(
      text("("),
      printMojoExpressionDocument(expression.expression, context),
      text(")"),
    );
    case "lambda": {
      const captures = expression.captures.length === 0
        ? emptyDocument
        : concat(text(" "), printLambdaCaptures(expression.captures));
      const result = printMojoTypeDocument(expression.resultType, context);
      return group(concat(
        text("lambda "),
        delimitedList(
          "(",
          expression.parameters.map((parameter) => printParameterDocument(parameter, context)),
          ")",
        ),
        expression.raises
          ? concat(
              text(" raises"),
              expression.errorType === undefined
                ? emptyDocument
                : concat(text(" "), requiredMojoTypeDocument(expression.errorType, context)),
            )
          : emptyDocument,
        captures,
        result === undefined ? emptyDocument : concat(text(" -> "), result),
        text(": "),
        parenthesizeWhenBroken(
          printMojoExpressionDocument(expression.expression, context, lambdaPrecedence),
        ),
      ));
    }
  }
}

function printBinaryDocument(
  expression: Extract<MojoExpression, { readonly kind: "binary" }>,
  context: MojoPrintContext,
  precedence: number,
): MojoDocument {
  if (expression.operator === "and" || expression.operator === "or") {
    const operands: MojoExpression[] = [];
    let current: MojoExpression = expression;
    while (current.kind === "binary" && current.operator === expression.operator) {
      operands.push(current.right);
      current = current.left;
    }
    operands.push(current);
    operands.reverse();
    const documents = operands.map((operand) => printMojoExpressionDocument(operand, context, precedence + 1));
    return chooseLayout(join(text(` ${expression.operator} `), documents), parenthesizeWhenBroken(join(
      concat(line, text(`${expression.operator} `)),
      documents,
    )));
  }
  const left = printMojoExpressionDocument(expression.left, context, precedence === 40 ? precedence + 1 : precedence);
  const right = printMojoExpressionDocument(expression.right, context, precedence + 1);
  return chooseLayout(concat(left, text(` ${expression.operator} `), right), parenthesizeWhenBroken(concat(
    left,
    line,
    text(`${expression.operator} `),
    right,
  )));
}

function parenthesizeWhenBroken(document: MojoDocument): MojoDocument {
  return group(concat(
    ifBreak(text("(")),
    indent(4, concat(ifBreak(hardLine), document)),
    ifBreak(hardLine),
    ifBreak(text(")")),
  ));
}

export function printParameterDocument(
  parameter: MojoParameter,
  context: MojoPrintContext,
): MojoDocument {
  const convention = parameter.convention === undefined || parameter.convention === "imm"
    ? ""
    : `${parameter.convention} `;
  return group(concat(
    text(`${convention}${parameter.variadic === true ? "*" : ""}${parameter.name}: `),
    requiredMojoTypeDocument(parameter.type, context),
    parameter.defaultValue === undefined
      ? emptyDocument
      : concat(text(" = "), printMojoExpressionDocument(parameter.defaultValue, context)),
  ));
}

function printCallArguments(
  arguments_: readonly MojoCallArgument[],
  context: MojoPrintContext,
): MojoDocument {
  return delimitedList("(", arguments_.map((argument) => printCallArgument(argument, context)), ")");
}

function printCallArgument(
  argument: MojoCallArgument,
  context: MojoPrintContext,
): MojoDocument {
  return concat(
    argument.name === undefined ? emptyDocument : text(`${argument.name}=`),
    argument.spread === true ? text("*") : emptyDocument,
    printMojoExpressionDocument(argument.value, context),
  );
}

export function printLambdaCaptures(captures: readonly MojoLambdaCapture[]): MojoDocument {
  return delimitedList("{", captures.map((capture) => text(
    `${capture.convention} ${capture.name}${capture.transfer === true ? "^" : ""}`,
  )), "}");
}

function expressionPrecedence(expression: MojoExpression): number {
  switch (expression.kind) {
    case "lambda": return lambdaPrecedence;
    case "conditional": return conditionalPrecedence;
    case "binary": return binaryOperatorPrecedence(expression.operator);
    case "unary":
    case "await": return unaryPrecedence;
    case "call":
    case "method-call":
    case "member":
    case "element":
    case "proven-union-member":
    case "slice":
    case "construct":
    case "copy":
    case "consume":
    case "postfix-deref": return postfixPrecedence;
    case "path":
    case "qualified-path":
    case "type-value":
    case "string-literal":
    case "number-literal":
    case "bool-literal":
    case "none-literal":
    case "tuple":
    case "list":
    case "dictionary":
    case "forced-comptime":
    case "generic-argument-value":
    case "materialize":
    case "parenthesized": return atomPrecedence;
  }
}

function binaryOperatorPrecedence(operator: string): number {
  switch (operator) {
    case "or": return 20;
    case "and": return 30;
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "is":
    case "is not":
    case "in":
    case "not in": return 40;
    case "|": return 50;
    case "^": return 55;
    case "&": return 60;
    case "<<":
    case ">>": return 70;
    case "+":
    case "-": return 80;
    case "*":
    case "/":
    case "//":
    case "%": return 85;
    default: return 45;
  }
}

function quoteMojoString(value: string): string {
  const doubleQuoted = JSON.stringify(value).replace(/\\u2028/gu, "\\u{2028}").replace(/\\u2029/gu, "\\u{2029}");
  const singleQuoted = `'${doubleQuoted.slice(1, -1).replace(/\\.|'/gu, (token) =>
    token === '\\"' ? '"' : token === "'" ? "\\'" : token)}'`;
  return singleQuoted.length < doubleQuoted.length ? singleQuoted : doubleQuoted;
}

function renderQualifiedPath(
  segments: readonly string[],
  context: MojoPrintContext,
): string {
  let selected: { readonly prefixLength: number; readonly localName: string } | undefined;
  for (const [identity, localName] of context.importedSymbols) {
    const separator = identity.indexOf("\0");
    const modulePath = identity.slice(0, separator).split(".");
    const symbol = identity.slice(separator + 1);
    const prefix = [...modulePath, symbol];
    if (prefix.length > segments.length ||
      !prefix.every((segment, index) => segments[index] === segment)) continue;
    if (selected === undefined || prefix.length > selected.prefixLength) {
      selected = { prefixLength: prefix.length, localName };
    }
  }
  return selected === undefined
    ? segments.join(".")
    : [selected.localName, ...segments.slice(selected.prefixLength)].join(".");
}
