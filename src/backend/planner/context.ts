import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetProgram } from "../../analysis/program/model.js";
import type { MojoImportDeclaration } from "../target-ast/nodes.js";

export interface MojoPlanningContext {
  readonly program: MojoTargetProgram;
  readonly diagnostics: TargetDiagnostic[];
  readonly imports: Map<string, MojoImportDeclaration>;
  readonly usedNames: Set<string>;
  syntheticNameCounter: number;
}

export function createMojoPlanningContext(program: MojoTargetProgram): MojoPlanningContext {
  return {
    program,
    diagnostics: [],
    imports: new Map<string, MojoImportDeclaration>(),
    usedNames: new Set(program.reservedNames),
    syntheticNameCounter: 0,
  };
}

export function allocateMojoSyntheticName(
  context: MojoPlanningContext,
  role: string,
): string {
  while (true) {
    context.syntheticNameCounter += 1;
    const candidate = `__tsonic_${role}_${context.syntheticNameCounter}`;
    if (context.usedNames.has(candidate)) continue;
    context.usedNames.add(candidate);
    return candidate;
  }
}

export function registerMojoModuleImport(
  context: MojoPlanningContext,
  modulePath: readonly string[],
): void {
  if (modulePath.length === 0) return;
  const identity = `module:${modulePath.join(".")}`;
  const declaration = Object.freeze({
    kind: "module" as const,
    modulePath: Object.freeze([...modulePath]),
  });
  const existing = context.imports.get(identity);
  if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(declaration)) {
    throw new Error(`Mojo import '${identity}' has conflicting sealed declarations.`);
  }
  context.imports.set(identity, declaration);
}

export function registerMojoSymbolImport(
  context: MojoPlanningContext,
  modulePath: readonly string[],
  symbol: string,
): void {
  if (modulePath.length === 0 || symbol.length === 0) return;
  const identity = `symbols:${modulePath.join(".")}`;
  const existing = context.imports.get(identity);
  if (existing !== undefined && existing.kind !== "symbols") {
    throw new Error(`Mojo import '${identity}' has conflicting sealed declarations.`);
  }
  const symbols = new Map<string, import("../target-ast/nodes.js").MojoImportedSymbol>();
  for (const imported of existing?.kind === "symbols" ? existing.symbols : []) {
    symbols.set(`${imported.name}:${imported.alias ?? ""}`, imported);
  }
  symbols.set(`${symbol}:`, Object.freeze({ name: symbol }));
  context.imports.set(identity, Object.freeze({
    kind: "symbols" as const,
    modulePath: Object.freeze([...modulePath]),
    symbols: Object.freeze([...symbols.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en") ||
      (left.alias ?? "").localeCompare(right.alias ?? "", "en"))),
  }));
}

export function appendMojoPlanningDiagnostic(
  context: MojoPlanningContext,
  code: string,
  message: string,
  sourceNode: Node,
): void {
  context.diagnostics.push(Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    sourceNode,
    evidence: Object.freeze(["target.capability=mojo.backend.planning"]),
  }));
}
