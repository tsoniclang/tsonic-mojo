import type {
  MojoCompilerConditionValue,
  MojoCompilerConformanceCondition,
} from "./model.js";
import type { MojoCompilerTypeScope } from "./type-parser.js";

const qualifiedIdentifierPattern = /^[_A-Za-z][_A-Za-z0-9]*(?:\.[_A-Za-z][_A-Za-z0-9]*)*$/u;

export function parseMojoCompilerConformanceCondition(
  expression: string,
  _scope: MojoCompilerTypeScope,
): MojoCompilerConformanceCondition {
  return parseCondition(expression.trim());
}

function parseCondition(expression: string): MojoCompilerConformanceCondition {
  const text = stripOuterParentheses(expression);
  if (text.length === 0) throw new Error("Mojo compiler emitted an empty conformance condition.");
  const conditional = splitTopLevelConditional(text);
  if (conditional !== undefined) {
    return Object.freeze({
      kind: "conditional",
      condition: parseCondition(conditional.condition),
      whenTrue: parseCondition(conditional.whenTrue),
      whenFalse: parseCondition(conditional.whenFalse),
    });
  }
  const alternatives = splitTopLevelKeyword(text, "or");
  if (alternatives.length > 1) {
    return Object.freeze({
      kind: "any",
      operands: Object.freeze(alternatives.map(parseCondition)),
    });
  }
  const requirements = splitTopLevelKeyword(text, "and");
  if (requirements.length > 1) {
    return Object.freeze({
      kind: "all",
      operands: Object.freeze(requirements.map(parseCondition)),
    });
  }
  if (text.startsWith("not ")) {
    return Object.freeze({ kind: "not", operand: parseCondition(text.slice(4)) });
  }
  if (text === "True" || text === "False") {
    return Object.freeze({ kind: "boolean", value: text === "True" });
  }
  const conforms = /^conforms_to\(([_A-Za-z][_A-Za-z0-9]*),\s*([_A-Za-z][_A-Za-z0-9]*(?:\s*&\s*[_A-Za-z][_A-Za-z0-9]*)*)\)$/u.exec(text);
  if (conforms !== null) {
    return Object.freeze({
      kind: "conforms-to",
      subject: conforms[1]!,
      traitNames: Object.freeze(conforms[2]!.split("&").map((part) => part.trim())),
    });
  }
  const equality = splitTopLevelOperator(text, "==");
  if (equality !== undefined) {
    return Object.freeze({
      kind: "equals",
      left: parseConditionValue(equality.left),
      right: parseConditionValue(equality.right),
    });
  }
  try {
    return Object.freeze({ kind: "predicate", value: parseConditionValue(text) });
  } catch {
    throw new Error(`Mojo compiler conformance condition '${text}' is not structurally supported.`);
  }
}

function parseConditionValue(expression: string): MojoCompilerConditionValue {
  const text = stripOuterParentheses(expression.trim());
  const genericCall = /^([_A-Za-z][_A-Za-z0-9]*(?:\.[_A-Za-z][_A-Za-z0-9]*)*)\[(.*)\]\(\)$/u.exec(text);
  if (genericCall !== null) {
    const arguments_ = splitTopLevel(genericCall[2]!);
    if (arguments_.some((argument) => !qualifiedIdentifierPattern.test(argument))) {
      throw new Error(`Mojo compiler condition call '${text}' has an unsupported type argument.`);
    }
    return Object.freeze({
      kind: "generic-call",
      receiver: Object.freeze(genericCall[1]!.split(".")),
      typeArguments: Object.freeze(arguments_),
    });
  }
  if (!qualifiedIdentifierPattern.test(text)) {
    throw new Error(`Mojo compiler condition value '${text}' is not a qualified identifier.`);
  }
  return Object.freeze({ kind: "path", segments: Object.freeze(text.split(".")) });
}

function stripOuterParentheses(expression: string): string {
  let text = expression.trim();
  while (text.startsWith("(") && matchingDelimiter(text, 0, "(", ")") === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function splitTopLevelConditional(
  text: string,
): { readonly whenTrue: string; readonly condition: string; readonly whenFalse: string } | undefined {
  const ifIndex = findTopLevelKeyword(text, "if");
  if (ifIndex === undefined) return undefined;
  const elseIndex = findTopLevelKeyword(text, "else", ifIndex + 4);
  if (elseIndex === undefined) {
    throw new Error(`Mojo compiler conditional conformance '${text}' has no else branch.`);
  }
  const whenTrue = text.slice(0, ifIndex).trim();
  const condition = text.slice(ifIndex + 2, elseIndex).trim();
  const whenFalse = text.slice(elseIndex + 4).trim();
  if (whenTrue.length === 0 || condition.length === 0 || whenFalse.length === 0) {
    throw new Error(`Mojo compiler conditional conformance '${text}' is incomplete.`);
  }
  return Object.freeze({ whenTrue, condition, whenFalse });
}

function splitTopLevelKeyword(text: string, keyword: "and" | "or"): readonly string[] {
  const parts: string[] = [];
  let start = 0;
  while (true) {
    const index = findTopLevelKeyword(text, keyword, start);
    if (index === undefined) break;
    const part = text.slice(start, index).trim();
    if (part.length === 0) throw new Error(`Mojo compiler condition '${text}' has an empty operand.`);
    parts.push(part);
    start = index + keyword.length;
  }
  const tail = text.slice(start).trim();
  if (tail.length === 0) throw new Error(`Mojo compiler condition '${text}' has an empty operand.`);
  parts.push(tail);
  return Object.freeze(parts);
}

function findTopLevelKeyword(text: string, keyword: string, start = 0): number | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    if (index >= start && square === 0 && round === 0 && text.slice(index, index + keyword.length) === keyword &&
      (index === 0 || /\s/u.test(text[index - 1]!)) &&
      (index + keyword.length === text.length || /\s/u.test(text[index + keyword.length]!))) return index;
  }
  return undefined;
}

function splitTopLevelOperator(
  text: string,
  operator: "==",
): { readonly left: string; readonly right: string } | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index + operator.length <= text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    if (square === 0 && round === 0 && text.slice(index, index + operator.length) === operator) {
      const left = text.slice(0, index).trim();
      const right = text.slice(index + operator.length).trim();
      if (left.length === 0 || right.length === 0) {
        throw new Error(`Mojo compiler condition '${text}' has an incomplete comparison.`);
      }
      return Object.freeze({ left, right });
    }
  }
  return undefined;
}

function matchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close && --depth === 0) return index;
  }
  throw new Error(`Unbalanced Mojo compiler condition '${text}'.`);
}

function splitTopLevel(text: string): readonly string[] {
  const parts: string[] = [];
  let square = 0;
  let round = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "," && square === 0 && round === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  if (square !== 0 || round !== 0 || parts.some((part) => part.length === 0)) {
    throw new Error(`Unbalanced Mojo compiler condition '${text}'.`);
  }
  return Object.freeze(parts);
}
