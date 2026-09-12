import type { MojoDocFunctionOverload } from "./mojo-doc-schema.js";
import type { MojoCompilerType } from "./model.js";
import type { MojoCompilerTypeScope } from "./type-parser.js";
import { parseCallableParameter, parseMojoCompilerType } from "./type-parser.js";
import { firstTopLevelDelimiter, matchingDelimiter, splitTopLevel } from "./type-expression-scanner.js";

export function mojoCompilerSignatureReferences(
  overload: MojoDocFunctionOverload,
  scope: MojoCompilerTypeScope,
): ReadonlyMap<number, Extract<MojoCompilerType, { readonly kind: "reference" }>> {
  const references = new Map<number, Extract<MojoCompilerType, { readonly kind: "reference" }>>();
  if (!overload.args.some((argument) => argument.convention === "ref")) return references;
  const signature = overload.signature.trim();
  const prefix = `${overload.async ? "async " : ""}def ${overload.name}`;
  if (!signature.startsWith(prefix)) throw new Error("Mojo reference signature has a contradictory declaration identity.");
  let cursor = prefix.length;
  if (signature[cursor] === "[") cursor = matchingDelimiter(signature, cursor, "[", "]") + 1;
  while (signature[cursor] === " ") cursor += 1;
  if (signature[cursor] !== "(") throw new Error("Mojo reference signature has no exact parameter list.");
  const close = matchingDelimiter(signature, cursor, "(", ")");
  const entries = splitTopLevel(signature.slice(cursor + 1, close))
    .filter((entry) => entry !== "/" && entry !== "*");
  if (entries.length !== overload.args.length) throw new Error("Mojo reference signature has contradictory parameter arity.");
  for (const [index, argument] of overload.args.entries()) {
    if (argument.convention !== "ref") continue;
    const entry = entries[index]!;
    const equal = firstTopLevelDelimiter(entry, "=");
    const selected = parseCallableParameter(equal === undefined ? entry : entry.slice(0, equal), scope);
    const value = parseMojoCompilerType(argument.type, argument.path, scope);
    const signatureValue = selected.type.kind === "reference" ? selected.type.target : undefined;
    const declaredValue = parseMojoCompilerType(argument.type, undefined, scope);
    if (selected.name !== argument.name || selected.convention !== "ref" || signatureValue === undefined ||
      JSON.stringify(signatureValue) !== JSON.stringify(declaredValue)) {
      throw new Error(`Mojo reference signature contradicts structured argument '${argument.name}'.`);
    }
    if (selected.type.kind === "reference") references.set(index, Object.freeze({ ...selected.type, target: value }));
  }
  return references;
}
