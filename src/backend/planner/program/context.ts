import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { MojoTargetProgram } from "../../../analysis/program/model.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../../target-model/types/model.js";
import {
  substituteMojoTargetGenericArguments,
  substituteMojoTargetType,
  type MojoTargetTypeSubstitutions,
} from "../../../target-model/types/substitution.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import type { MojoImportDeclaration } from "../../target-ast/index.js";
import type { MojoTypeAliasUse } from "../../target-ast/index.js";
import type { MojoDeclaration, MojoExpression } from "../../target-ast/index.js";
import { normalizeMojoIdentifier } from "../../../target-model/names/identifiers.js";

export interface MojoOutputPlanningContext {
  readonly program: MojoTargetProgram;
}

export interface MojoPlanningContext {
  readonly program: MojoTargetProgram;
  readonly module: MojoSourceModuleDefinition;
  readonly diagnostics: TargetDiagnostic[];
  readonly imports: Map<string, MojoImportDeclaration>;
  readonly usedNames: Set<string>;
  readonly declarationNames: Set<string>;
  readonly importNames: Set<string>;
  readonly importedSymbolNames: Map<string, string>;
  readonly typeAliases: Map<string, MojoTypeAliasUse>;
  readonly syntheticDeclarations: MojoDeclaration[];
  readonly callableArtifactNames: WeakMap<Node, string>;
  readonly bindingOverrides: ReadonlyMap<Node, MojoBindingPlanOverride>;
  readonly genericSubstitutions?: MojoTargetTypeSubstitutions;
  readonly errorType?: MojoTargetTypeRef;
  readonly selfType?: MojoTargetTypeRef;
  readonly selfExpression?: MojoExpression;
  readonly initializingState?: {
    readonly definition: import("../../../target-model/types/project.js").MojoProjectTypeDefinition;
    readonly referenceType: MojoTargetTypeRef;
    readonly stateType: MojoTargetTypeRef;
  };
  readonly initializingModuleState?: {
    readonly moduleId: string;
    readonly pointer: MojoExpression;
    readonly value: MojoExpression;
  };
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
  const analyzedModule = program.queries.moduleForId(module.id);
  const importNames = new Set(analyzedModule?.bindings.map((binding) => binding.name) ?? []);
  if (analyzedModule?.initializationStateRequired === true) {
    importNames.add(analyzedModule.stateName);
    importNames.add(analyzedModule.createStateName);
    importNames.add(analyzedModule.cellName);
  }
  if (analyzedModule?.runtimeInitializationRequired === true) {
    importNames.add(analyzedModule.initializeName);
  }
  for (const declaration of program.declarations) {
    if (program.modules.forSourceFile(declaration.sourceFile)?.id === module.id) {
      importNames.add(declaration.name);
    }
  }
  return {
    program,
    module,
    diagnostics: [],
    imports: new Map<string, MojoImportDeclaration>(),
    usedNames: new Set([...program.reservedNames, ...importNames]),
    declarationNames: new Set(importNames),
    importNames,
    importedSymbolNames: new Map<string, string>(),
    typeAliases: new Map<string, MojoTypeAliasUse>(),
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

export function withMojoGenericSubstitutions(
  context: MojoPlanningContext,
  genericSubstitutions: MojoTargetTypeSubstitutions,
): MojoPlanningContext {
  return Object.freeze({ ...context, genericSubstitutions });
}

export function mojoTargetTypeInContext(
  type: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoTargetTypeRef {
  return context.genericSubstitutions === undefined
    ? type
    : substituteMojoTargetType(type, context.genericSubstitutions);
}

export function mojoTargetGenericArgumentsInContext(
  arguments_: readonly MojoTargetGenericArgument[],
  context: MojoPlanningContext,
): readonly MojoTargetGenericArgument[] {
  return context.genericSubstitutions === undefined
    ? arguments_
    : substituteMojoTargetGenericArguments(arguments_, context.genericSubstitutions);
}

export function withMojoLocalNameScope(
  context: MojoPlanningContext,
): MojoPlanningContext {
  return Object.freeze({
    ...context,
    usedNames: new Set([...context.program.reservedNames, ...context.declarationNames]),
  });
}

export function withMojoStateInitialization(
  context: MojoPlanningContext,
  definition: import("../../../target-model/types/project.js").MojoProjectTypeDefinition,
  referenceType: MojoTargetTypeRef,
  stateType: MojoTargetTypeRef,
): MojoPlanningContext {
  return Object.freeze({
    ...context,
    initializingState: Object.freeze({ definition, referenceType, stateType }),
  });
}

export function withMojoModuleStateInitialization(
  context: MojoPlanningContext,
  moduleId: string,
  pointer: MojoExpression,
  value: MojoExpression,
): MojoPlanningContext {
  return Object.freeze({
    ...context,
    initializingModuleState: Object.freeze({ moduleId, pointer, value }),
  });
}

export function withMojoDeferredExecution(
  context: MojoPlanningContext,
): MojoPlanningContext {
  const {
    initializingState: ignoredStateInitialization,
    initializingModuleState: ignoredModuleStateInitialization,
    ...deferredContext
  } = context;
  void ignoredStateInitialization;
  void ignoredModuleStateInitialization;
  return Object.freeze(deferredContext);
}

export function withMojoErrorType(
  context: MojoPlanningContext,
  errorType: MojoTargetTypeRef | undefined,
): MojoPlanningContext {
  return Object.freeze({ ...context, errorType });
}

export function withMojoSelfType(
  context: MojoPlanningContext,
  selfType: MojoTargetTypeRef | undefined,
  selfExpression?: MojoExpression,
): MojoPlanningContext {
  return selfType === undefined
    ? context
    : Object.freeze({
        ...context,
        selfType,
        ...(selfExpression === undefined ? {} : { selfExpression }),
      });
}

export function mojoSelfExpression(context: MojoPlanningContext): MojoExpression {
  return context.selfExpression ?? Object.freeze({ kind: "path", path: "self" });
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
  const normalizedRole = normalizeMojoIdentifier(role).replace(/^_+/u, "") || "value";
  const base = `_${normalizedRole}`;
  let candidate = base;
  let suffix = 2;
  while (context.usedNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  context.usedNames.add(candidate);
  return candidate;
}

export function allocateMojoSyntheticDeclarationName(
  context: MojoPlanningContext,
  role: string,
): string {
  const normalizedRole = normalizeMojoIdentifier(role).replace(/^_+/u, "") || "value";
  const base = `_${normalizedRole}`;
  let candidate = base;
  let suffix = 2;
  while (context.declarationNames.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  context.declarationNames.add(candidate);
  context.usedNames.add(candidate);
  return candidate;
}

export function mojoModuleMemberExpression(
  context: MojoPlanningContext,
  modulePath: readonly string[],
  memberName: string,
): MojoExpression {
  if (sameModulePath(modulePath, context.module.modulePath)) {
    return Object.freeze({ kind: "path", path: memberName });
  }
  return Object.freeze({
    kind: "path",
    path: registerMojoSymbolImport(context, modulePath, memberName),
  });
}

export function mojoModulePathExpression(
  context: MojoPlanningContext,
  modulePath: readonly string[],
  memberPath: readonly string[],
): MojoExpression {
  if (memberPath.length === 0) throw new Error("A Mojo module member path cannot be empty.");
  const segments = sameModulePath(modulePath, context.module.modulePath)
    ? memberPath
    : [registerMojoSymbolImport(context, modulePath, memberPath[0]!), ...memberPath.slice(1)];
  return segments.length === 1
    ? Object.freeze({ kind: "path", path: segments[0]! })
    : Object.freeze({ kind: "qualified-path", segments: Object.freeze([...segments]) });
}

export function registerMojoSymbolImport(
  context: MojoPlanningContext,
  modulePath: readonly string[],
  symbol: string,
): string {
  if (modulePath.length === 0 || symbol.length === 0) return symbol;
  const referenceIdentity = `${modulePath.join(".")}\0${symbol}`;
  const selectedName = context.importedSymbolNames.get(referenceIdentity);
  if (selectedName !== undefined) return selectedName;
  let localName = symbol;
  if (context.importNames.has(localName)) {
    const prefix = normalizeMojoIdentifier(modulePath[modulePath.length - 1] ?? "module");
    const base = normalizeMojoIdentifier(`${prefix}_${symbol}`);
    localName = base;
    let suffix = 2;
    while (context.importNames.has(localName)) {
      localName = `${base}_${suffix}`;
      suffix += 1;
    }
  }
  context.importNames.add(localName);
  context.importedSymbolNames.set(referenceIdentity, localName);
  const identity = `symbols:${modulePath.join(".")}`;
  const existing = context.imports.get(identity);
  if (existing !== undefined && existing.kind !== "symbols") {
    throw new Error(`Mojo import '${identity}' has conflicting sealed declarations.`);
  }
  const symbols = new Map<string, import("../../target-ast/index.js").MojoImportedSymbol>();
  for (const imported of existing?.kind === "symbols" ? existing.symbols : []) {
    symbols.set(`${imported.name}:${imported.alias ?? ""}`, imported);
  }
  const imported = Object.freeze({
    name: symbol,
    ...(localName === symbol ? {} : { alias: localName }),
  });
  symbols.set(`${symbol}:${localName === symbol ? "" : localName}`, imported);
  context.imports.set(identity, Object.freeze({
    kind: "symbols" as const,
    modulePath: Object.freeze([...modulePath]),
    symbols: Object.freeze([...symbols.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "en") ||
      (left.alias ?? "").localeCompare(right.alias ?? "", "en"))),
  }));
  return localName;
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
