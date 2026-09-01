import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetProgram } from "../../../analysis/program/model.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import type { MojoImportDeclaration } from "../../target-ast/index.js";
import type { MojoDeclaration, MojoExpression } from "../../target-ast/index.js";

export interface MojoOutputPlanningContext {
  readonly program: MojoTargetProgram;
}

export interface MojoPlanningContext {
  readonly program: MojoTargetProgram;
  readonly module: MojoSourceModuleDefinition;
  readonly diagnostics: TargetDiagnostic[];
  readonly imports: Map<string, MojoImportDeclaration>;
  readonly usedNames: Set<string>;
  readonly syntheticNameState: { value: number };
  readonly syntheticDeclarations: MojoDeclaration[];
  readonly callableArtifactNames: WeakMap<Node, string>;
  readonly bindingOverrides: ReadonlyMap<Node, MojoBindingPlanOverride>;
}

export interface MojoBindingPlanOverride {
  readonly expression: MojoExpression;
  readonly storage: "value" | "location";
}

export function createMojoOutputPlanningContext(
  program: MojoTargetProgram,
): MojoOutputPlanningContext {
  return Object.freeze({ program });
}

export function createMojoPlanningContext(
  program: MojoTargetProgram,
  module: MojoSourceModuleDefinition,
): MojoPlanningContext {
  return {
    program,
    module,
    diagnostics: [],
    imports: new Map<string, MojoImportDeclaration>(),
    usedNames: new Set(program.reservedNames),
    syntheticNameState: { value: 0 },
    syntheticDeclarations: [],
    callableArtifactNames: new WeakMap<Node, string>(),
    bindingOverrides: new Map<Node, MojoBindingPlanOverride>(),
  };
}

export function withMojoBindingOverrides(
  context: MojoPlanningContext,
  bindingOverrides: ReadonlyMap<Node, MojoBindingPlanOverride>,
): MojoPlanningContext {
  return Object.freeze({ ...context, bindingOverrides });
}

export function mojoBindingPlanOverride(
  node: Node,
  context: MojoPlanningContext,
): MojoBindingPlanOverride | undefined {
  const reference = context.program.sourceNavigation.sourceReferenceFor(node);
  return context.bindingOverrides.get(reference?.declaration ?? node);
}

export function allocateMojoSyntheticName(
  context: MojoPlanningContext,
  role: string,
): string {
  while (true) {
    context.syntheticNameState.value += 1;
    const candidate = `__tsonic_${role}_${context.syntheticNameState.value}`;
    if (context.usedNames.has(candidate)) continue;
    context.usedNames.add(candidate);
    return candidate;
  }
}

export function registerMojoModuleImport(
  context: MojoPlanningContext,
  modulePath: readonly string[],
): void {
  if (modulePath.length === 0 || sameModulePath(modulePath, context.module.modulePath)) return;
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

export function mojoQualifiedModuleMember(
  context: MojoPlanningContext,
  modulePath: readonly string[],
  memberName: string,
): string {
  if (sameModulePath(modulePath, context.module.modulePath)) return memberName;
  registerMojoModuleImport(context, modulePath);
  return [...modulePath, memberName].join(".");
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
  const symbols = new Map<string, import("../../target-ast/index.js").MojoImportedSymbol>();
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

function sameModulePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}
