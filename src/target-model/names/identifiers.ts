const mojoKeywords = new Set([
  "abi", "alias", "and", "as", "assert", "async", "await", "break", "case",
  "comptime", "continue", "def", "deinit", "elif", "else", "fn", "for", "from",
  "if", "imm", "import", "in", "is", "let", "match", "mut", "not", "or", "out",
  "owned", "param", "pass", "raise", "raises", "read", "ref", "return", "struct",
  "thin", "trait", "try", "var", "while", "where", "with", "yield",
]);

const mojoReservedIdentifiers = new Set(["False", "None", "Self", "True", "self"]);

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function normalizeMojoIdentifier(sourceName: string): string {
  return isAuthoredConstantStyle(sourceName)
    ? normalizeCase(sourceName, "constant")
    : normalizeCase(sourceName, "snake");
}

export function normalizeMojoTypeIdentifier(sourceName: string): string {
  return normalizeCase(sourceName, "pascal");
}

export function normalizeMojoConstantIdentifier(sourceName: string): string {
  return normalizeCase(sourceName, "constant");
}

export function normalizeMojoModuleIdentifier(sourceName: string): string {
  const normalized = normalizeCase(sourceName, "snake");
  return normalized === "main" || normalized === "__init__"
    ? `${normalized}_module`
    : normalized;
}

export function normalizeMojoPackageDeclarationIdentifier(
  sourceName: string,
): string {
  const normalized = normalizeMojoIdentifier(sourceName);
  return normalized === "main" ? "tsonic_main" : normalized;
}

function normalizeCase(
  sourceName: string,
  style: "snake" | "pascal" | "constant",
): string {
  const words = identifierWords(sourceName);
  const leadingUnderscore = sourceName.startsWith("_") ? "_" : "";
  const joinedWords = words.join("_");
  const joined = style === "pascal"
    ? words.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`).join("")
    : style === "constant"
      ? joinedWords.toUpperCase()
      : joinedWords.toLowerCase();
  const fallback = style === "pascal" ? "Value" : style === "constant" ? "VALUE" : "value";
  const candidate = `${leadingUnderscore}${joined || fallback}`;
  const prefixed = /^[A-Za-z_]/u.test(candidate)
    ? candidate
    : `${style === "pascal" ? "Value" : style === "constant" ? "VALUE" : "value"}_${candidate}`;
  const valid = identifierPattern.test(prefixed) ? prefixed : fallback;
  return mojoKeywords.has(valid) || mojoReservedIdentifiers.has(valid) ? `${valid}_` : valid;
}

function identifierWords(sourceName: string): readonly string[] {
  return sourceName
    .replace(/^#+/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word.length > 0);
}

function isAuthoredConstantStyle(sourceName: string): boolean {
  const body = sourceName.replace(/^_+/u, "");
  return body.length > 1 && /^[A-Z][A-Z0-9_]*$/u.test(body) && /[A-Z]/u.test(body);
}
