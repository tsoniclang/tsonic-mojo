import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoTargetProgram,
} from "../../../analysis/program/model.js";
import type { MojoSourceModuleDefinition } from "../../../analysis/source-modules/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoComptimeDeclaration,
  MojoDeclaration,
  MojoExpression,
  MojoFunctionDeclaration,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import { mojoFieldwiseInitDecorators } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "./context.js";
import {
  registerMojoSymbolImport,
} from "./context.js";
import {
  planMojoValue,
} from "../expressions/value.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoProjectFunction } from "../declarations/project.js";
import { planMojoCompileTimeInitializer } from "../compile-time/values.js";
import {
  planInitializationComponent,
  planModuleInitializerBody,
} from "./module-initialization.js";
import {
  appendMojoModulePlanningFailure,
  optionalMojoModuleType,
} from "./module-state-support.js";

export function planMojoModuleState(
  program: MojoTargetProgram,
  definition: MojoSourceModuleDefinition,
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
): readonly MojoDeclaration[] | undefined {
  const comptimeBindings = module.bindings.filter((binding) => binding.disposition.kind === "comptime");
  const directFunctionBindings = module.bindings.filter((binding) =>
    binding.disposition.kind === "direct-function");
  const cellBindings = module.bindings.filter((binding) =>
    binding.disposition.kind === "immutable-runtime" || binding.disposition.kind === "live-cell");
  const component = program.moduleInitialization.componentForModuleId(module.id);
  if (component === undefined) {
    appendMojoModulePlanningFailure(
      context,
      context.diagnostics.length,
      "MOJO_MODULE_INITIALIZATION_COMPONENT_MISSING",
      `Source module '${definition.relativeSourcePath}' has no sealed initialization component.`,
      module.sourceFile,
    );
    return undefined;
  }
  const ownsInitialization = component.ownerModuleId === module.id;
  const ownsLifecycle = ownsInitialization && component.directRuntimeInitializationRequired;
  const stateRequired = cellBindings.length > 0 || ownsLifecycle;
  const declarations: MojoDeclaration[] = [];
  for (const binding of comptimeBindings) {
    const diagnosticCount = context.diagnostics.length;
    const declaration = planComptimeBinding(binding, context);
    if (declaration === undefined) {
      appendMojoModulePlanningFailure(
        context,
        diagnosticCount,
        "MOJO_COMPTIME_BINDING_NOT_PLANNED",
        `Top-level binding '${binding.sourceName}' has no exact compile-time Mojo initializer plan.`,
        binding.initializer,
      );
      return undefined;
    }
    declarations.push(declaration);
  }
  for (const binding of directFunctionBindings) {
    const diagnosticCount = context.diagnostics.length;
    const declaration = planDirectFunctionBinding(binding, context);
    if (declaration === undefined) {
      appendMojoModulePlanningFailure(
        context,
        diagnosticCount,
        "MOJO_DIRECT_FUNCTION_BINDING_NOT_PLANNED",
        `Top-level callable '${binding.sourceName}' has no exact direct Mojo function plan.`,
        binding.initializer,
      );
      return undefined;
    }
    declarations.push(declaration);
  }
  if (!component.runtimeInitializationRequired && cellBindings.length === 0) {
    return Object.freeze(declarations);
  }

  let scopedLockType: MojoTargetTypeRef | undefined;
  if (stateRequired) {
    const stateType = moduleStateType(definition, module);
    const lockType = namedType("mojo.std.utils.BlockingSpinLock", ["std", "utils"], "BlockingSpinLock");
    if (ownsLifecycle) {
      scopedLockType = namedType("mojo.std.utils.BlockingScopedLock", ["std", "utils"], "BlockingScopedLock");
    }
    registerMojoTypeImports(stateType, context);
    if (ownsLifecycle) {
      registerMojoTypeImports(lockType, context);
      registerMojoTypeImports(scopedLockType!, context);
    }
    registerMojoSymbolImport(context, ["std", "collections"], "Optional");
    declarations.push(moduleStateStruct(module, cellBindings, ownsLifecycle ? lockType : undefined));
    declarations.push(moduleStateFactory(
      module,
      stateType,
      cellBindings,
      ownsLifecycle ? lockType : undefined,
    ));
    declarations.push(moduleStateCell(module, definition.id, context));
  }
  if (module.directRuntimeInitializationRequired) {
    const diagnosticCount = context.diagnostics.length;
    const body = planModuleInitializerBody(module, cellBindings.length > 0, context);
    if (body === undefined) {
      appendMojoModulePlanningFailure(
        context,
        diagnosticCount,
        "MOJO_MODULE_INITIALIZER_BODY_NOT_PLANNED",
        `Source module '${definition.relativeSourcePath}' has no exact runtime initializer body.`,
        module.sourceFile,
      );
      return undefined;
    }
    declarations.push(body);
  }
  if (ownsInitialization && component.runtimeInitializationRequired) {
    const diagnosticCount = context.diagnostics.length;
    const initializer = planInitializationComponent(
      program,
      component,
      module,
      scopedLockType,
      context,
    );
    if (initializer === undefined) {
      appendMojoModulePlanningFailure(
        context,
        diagnosticCount,
        "MOJO_MODULE_INITIALIZER_NOT_PLANNED",
        `Source module '${definition.relativeSourcePath}' has no exact component initializer plan.`,
        module.sourceFile,
      );
      return undefined;
    }
    declarations.push(initializer);
  }
  return Object.freeze(declarations);
}

function moduleStateStruct(
  module: MojoAnalyzedModule,
  bindings: readonly MojoAnalyzedModuleBinding[],
  lockType: MojoTargetTypeRef | undefined,
): MojoStructDeclaration {
  return Object.freeze({
    kind: "struct",
    name: module.stateName,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze([
      ...(lockType === undefined ? [] : [
        Object.freeze({ name: module.lifecycleLockName, type: lockType, compileTime: false }),
        Object.freeze({
          name: module.lifecycleInitializedName,
          type: Object.freeze({ kind: "source-primitive" as const, name: "bool" as const }),
          compileTime: false,
        }),
      ]),
      ...bindings.map((binding) => Object.freeze({
        name: binding.name,
        type: optionalMojoModuleType(binding.type),
        compileTime: false,
      })),
    ]),
    methods: Object.freeze([]),
    decorators: mojoFieldwiseInitDecorators,
  });
}

function moduleStateFactory(
  module: MojoAnalyzedModule,
  stateType: MojoTargetTypeRef,
  bindings: readonly MojoAnalyzedModuleBinding[],
  lockType: MojoTargetTypeRef | undefined,
): MojoFunctionDeclaration {
  return Object.freeze({
    kind: "function",
    name: module.createStateName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([]),
    resultType: stateType,
    asynchronous: false,
    raises: false,
    statements: Object.freeze([Object.freeze({
      kind: "return",
      expression: Object.freeze({
        kind: "construct",
        type: stateType,
        arguments: Object.freeze([
          ...(lockType === undefined ? [] : [
            Object.freeze({ value: construct(lockType) }),
            Object.freeze({ value: Object.freeze({ kind: "bool-literal" as const, value: false }) }),
          ]),
          ...bindings.map((binding) => Object.freeze({ value: emptyModuleBinding(binding) })),
        ]),
      }),
    })]),
  });
}

function moduleStateCell(
  module: MojoAnalyzedModule,
  identity: string,
  context: MojoPlanningContext,
): MojoComptimeDeclaration {
  const cellType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: "tsonic.mojo.runtime.GlobalCell",
    modulePath: Object.freeze(["tsonic_runtime"]),
    name: "GlobalCell",
    genericArguments: Object.freeze([
      Object.freeze({ kind: "static-string", value: `tsonic.module.${identity}` }),
      Object.freeze({ kind: "value-reference", path: Object.freeze([module.createStateName]) }),
    ]),
  });
  registerMojoTypeImports(cellType, context);
  return Object.freeze({
    kind: "comptime",
    name: module.cellName,
    genericParameters: Object.freeze([]),
    initializer: construct(cellType),
  });
}

function planDirectFunctionBinding(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (binding.disposition.kind !== "direct-function") return undefined;
  const selection = context.program.queries.callableExpressionSelection(
    binding.disposition.expression,
  );
  if (selection === undefined) return undefined;
  return planMojoProjectFunction(Object.freeze({
    kind: "function" as const,
    declaration: selection.expression,
    sourceFile: binding.sourceFile,
    name: binding.name,
    typeParameters: Object.freeze([]),
    parameters: selection.parameters,
    resultType: selection.resultType,
    body: selection.body,
    asynchronous: false,
    raises: selection.raises,
    ...(selection.errorType === undefined ? {} : { errorType: selection.errorType }),
  }), context);
}

function planComptimeBinding(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoComptimeDeclaration | undefined {
  const value = planMojoCompileTimeInitializer(
    binding.initializer,
    context,
    planMojoValue,
    binding.type,
  );
  if (value === undefined || value.before.length !== 0) return undefined;
  registerMojoTypeImports(binding.type, context);
  return Object.freeze({
    kind: "comptime",
    name: binding.name,
    genericParameters: Object.freeze([]),
    type: binding.type,
    initializer: value.value,
  });
}

function moduleStateType(
  definition: MojoSourceModuleDefinition,
  module: MojoAnalyzedModule,
): MojoTargetTypeRef {
  return namedType(`tsonic.mojo.module:${definition.id}:state`, definition.modulePath, module.stateName);
}

function namedType(id: string, modulePath: readonly string[], name: string): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id,
    modulePath: Object.freeze([...modulePath]),
    name,
  });
}

function construct(type: MojoTargetTypeRef): MojoExpression {
  return Object.freeze({ kind: "construct", type, arguments: Object.freeze([]) });
}

function emptyModuleBinding(binding: MojoAnalyzedModuleBinding): MojoExpression {
  return construct(optionalMojoModuleType(binding.type));
}
