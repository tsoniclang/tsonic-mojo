export function lastTopLevelMemberSeparator(text: string): number | undefined {
  let square = 0;
  let round = 0;
  let result: number | undefined;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "." && square === 0 && round === 0) result = index;
    assertDepth(text, square, round);
  }
  assertClosed(text, square, round);
  return result;
}

export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  const stack: string[] = [];
  let quoted: '"' | "'" | undefined;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quoted) quoted = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quoted = character;
      continue;
    }
    if (character === "[" || character === "(") stack.push(character);
    else if (character === "]" || character === ")") {
      const expected = character === "]" ? "[" : "(";
      if (stack.pop() !== expected) throw unbalanced(text);
    } else if (character === "," && stack.length === 0) {
      const part = text.slice(start, index).trim();
      if (part.length === 0) throw new Error(`Empty Mojo compiler expression component in '${text}'.`);
      parts.push(part);
      start = index + 1;
    }
  }
  if (quoted !== undefined || stack.length !== 0) throw unbalanced(text);
  const tail = text.slice(start).trim();
  if (tail.length === 0) throw new Error(`Empty Mojo compiler expression component in '${text}'.`);
  parts.push(tail);
  return parts;
}

export function matchingDelimiter(text: string, openIndex: number, open: string, close: string): number {
  if (text[openIndex] !== open) throw new Error(`Expected '${open}' in Mojo compiler expression '${text}'.`);
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    else if (text[index] === close && --depth === 0) return index;
  }
  throw unbalanced(text);
}

export function firstTopLevelDelimiter(text: string, delimiter: string): number | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === delimiter && square === 0 && round === 0) return index;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    assertDepth(text, square, round);
  }
  assertClosed(text, square, round);
  return undefined;
}

export function findTopLevelArrow(text: string): number | undefined {
  let square = 0;
  let round = 0;
  for (let index = 0; index + 1 < text.length; index += 1) {
    const character = text[index]!;
    if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    else if (character === "-" && text[index + 1] === ">" && square === 0 && round === 0) return index;
    assertDepth(text, square, round);
  }
  assertClosed(text, square, round);
  return undefined;
}

export function isBalancedExpression(text: string): boolean {
  try {
    splitTopLevel(text);
    return true;
  } catch {
    return false;
  }
}

function assertDepth(text: string, square: number, round: number): void {
  if (square < 0 || round < 0) throw unbalanced(text);
}

function assertClosed(text: string, square: number, round: number): void {
  if (square !== 0 || round !== 0) throw unbalanced(text);
}

function unbalanced(text: string): Error {
  return new Error(`Unbalanced Mojo compiler expression '${text}'.`);
}
