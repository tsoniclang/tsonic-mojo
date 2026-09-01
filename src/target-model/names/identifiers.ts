const mojoKeywords = new Set([
  "alias", "as", "async", "await", "break", "case", "comptime", "continue",
  "def", "else", "fn", "for", "from", "if", "import", "in", "is", "let",
  "match", "mut", "out", "owned", "param", "pass", "raise", "raises",
  "ref", "return", "struct", "trait", "try", "var", "while", "with", "yield",
]);

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function normalizeMojoIdentifier(sourceName: string): string {
  const normalized = identifierPattern.test(sourceName)
    ? sourceName
    : sourceName.replace(/[^A-Za-z0-9_]/gu, "_");
  const prefixed = /^[A-Za-z_]/u.test(normalized) ? normalized : `_${normalized}`;
  const nonempty = prefixed.length === 0 ? "value" : prefixed;
  return mojoKeywords.has(nonempty) ? `${nonempty}_` : nonempty;
}

export function normalizeMojoPackageDeclarationIdentifier(
  sourceName: string,
): string {
  const normalized = normalizeMojoIdentifier(sourceName);
  return normalized === "main" ? "tsonic_main" : normalized;
}
