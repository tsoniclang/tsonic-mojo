import {
  Node_Expression,
} from "@tsonic/target-api/source";
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
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import type { MojoPlanningContext } from "./context.js";
import {
  allocateMojoSyntheticName,
  mojoQualifiedModuleMember,
  registerMojoModuleImport,
  registerMojoSymbolImport,
} from "./context.js";
import {
  planMojoAssignment,
  planMojoUpdate,
  planMojoValue,
} from "../expressions/value.js";
import { mojoModuleBindingSlot, mojoModuleStatePointerExpression } from "../bindings/module-bindings.js";
import { registerMojoTypeImports } from "../types/render.js";
import { planMojoStatementRegion } from "../statements/structured.js";
import { planMojoResourceScope } from "../statements/resources.js";

export function planMojoModuleState(
  program: MojoTargetProgram,
  definition: MojoSourceModuleDefinition,
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
): readonly MojoDeclaration[] | undefined {
  const comptimeBindings = module.bindings.filter((binding) => binding.storage === "comptime");
  const cellBindings = module.bindings.filter((binding) => binding.storage === "cell");
  const declarations: MojoDeclaration[] = [];
  for (const binding of comptimeBindings) {
    const diagnosticCount = context.diagnostics.length;
    const declaration = planComptimeBinding(binding, context);
    if (declaration === undefined) {
      appendPlanningFailure(
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
  if (!module.runtimeInitializationRequired && cellBindings.length === 0) {
    return Object.freeze(declarations);
  }

  const stateType = moduleStateType(definition, module);
  const lockType = namedType("mojo.std.utils.BlockingSpinLock", ["std", "utils"], "BlockingSpinLock");
  const scopedLockType = namedType("mojo.std.utils.BlockingScopedLock", ["std", "utils"], "BlockingScopedLock");
  registerMojoTypeImports(stateType, context);
  registerMojoTypeImports(lockType, context);
  registerMojoTypeImports(scopedLockType, context);
  registerMojoModuleImport(context, ["tsonic_runtime"]);
  registerMojoSymbolImport(context, ["std", "collections"], "Optional");

  declarations.push(moduleStateStruct(module, cellBindings, lockType));
  declarations.push(moduleStateFactory(module, stateType, cellBindings, lockType));
  declarations.push(moduleStateCell(module, definition.id));
  const diagnosticCount = context.diagnostics.length;
  const initializer = planModuleInitializer(program, definition, module, scopedLockType, context);
  if (initializer === undefined) {
    appendPlanningFailure(
      context,
      diagnosticCount,
      "MOJO_MODULE_INITIALIZER_NOT_PLANNED",
      `Source module '${definition.relativeSourcePath}' has no exact runtime initializer plan.`,
      module.sourceFile,
    );
    return undefined;
  }
  declarations.push(initializer);
  return Object.freeze(declarations);
}

function moduleStateStruct(
  module: MojoAnalyzedModule,
  bindings: readonly MojoAnalyzedModuleBinding[],
  lockType: MojoTargetTypeRef,
): MojoStructDeclaration {
  return Object.freeze({
    kind: "struct",
    name: module.stateName,
    genericParameters: Object.freeze([]),
    conformances: Object.freeze([]),
    fields: Object.freeze([
      Object.freeze({ name: module.lifecycleLockName, type: lockType, compileTime: false }),
      Object.freeze({
        name: module.lifecycleInitializedName,
        type: Object.freeze({ kind: "source-primitive" as const, name: "bool" as const }),
        compileTime: false,
      }),
      ...bindings.map((binding) => Object.freeze({
        name: binding.name,
        type: optionalType(binding.type),
        compileTime: false,
      })),
    ]),
    methods: Object.freeze([]),
    decorators: Object.freeze(["fieldwise_init"]),
  });
}

function moduleStateFactory(
  module: MojoAnalyzedModule,
  stateType: MojoTargetTypeRef,
  bindings: readonly MojoAnalyzedModuleBinding[],
  lockType: MojoTargetTypeRef,
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
          Object.freeze({ value: construct(lockType) }),
          Object.freeze({ value: Object.freeze({ kind: "bool-literal", value: false }) }),
          ...bindings.map((binding) => Object.freeze({ value: emptyModuleBinding(binding) })),
        ]),
      }),
    })]),
  });
}

function moduleStateCell(
  module: MojoAnalyzedModule,
  identity: string,
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
  return Object.freeze({
    kind: "comptime",
    name: module.cellName,
    genericParameters: Object.freeze([]),
    initializer: construct(cellType),
  });
}

function planModuleInitializer(
  program: MojoTargetProgram,
  definition: MojoSourceModuleDefinition,
  module: MojoAnalyzedModule,
  scopedLockType: MojoTargetTypeRef,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (module.errorType !== undefined) registerMojoTypeImports(module.errorType, context);
  const stateName = allocateMojoSyntheticName(context, "module_state");
  const statePointer = mojoModuleStatePointerExpression(module, context);
  if (statePointer === undefined) {
    appendPlanningFailure(
      context,
      context.diagnostics.length,
      "MOJO_MODULE_STATE_OWNER_NOT_PLANNED",
      `Source module '${definition.relativeSourcePath}' has no exact module-state owner.`,
      module.sourceFile,
    );
    return undefined;
  }
  const state = Object.freeze({
    kind: "postfix-deref" as const,
    expression: Object.freeze({ kind: "path" as const, path: stateName }),
  });
  const initialization: MojoStatement[] = [];
  for (const dependency of definition.dependencies) {
    const target = program.queries.moduleForId(dependency.target.id);
    if (target === undefined || !target.runtimeInitializationRequired) continue;
    const call = Object.freeze({
      kind: "call" as const,
      callee: Object.freeze({
        kind: "path" as const,
        path: mojoQualifiedModuleMember(context, dependency.target.modulePath, target.initializeName),
      }),
      arguments: Object.freeze([]),
    });
    initialization.push(Object.freeze({
      kind: "expression",
      expression: target.asynchronous
        ? Object.freeze({
            kind: "await",
            expression: Object.freeze({
              kind: "call",
              callee: Object.freeze({
                kind: "path",
                path: target.raises
                  ? "tsonic_runtime.create_raising_task"
                  : "tsonic_runtime.create_task",
              }),
              arguments: Object.freeze([Object.freeze({ value: call })]),
            }),
          })
        : call,
    }));
  }
  const sourceInitialization = planModuleInitializationSteps(module, context, 0);
  if (sourceInitialization === undefined) return undefined;
  initialization.push(...sourceInitialization);
  initialization.push(Object.freeze({
    kind: "assignment",
    operator: "=",
    left: Object.freeze({
      kind: "member",
      receiver: state,
      name: module.lifecycleInitializedName,
    }),
    right: Object.freeze({ kind: "bool-literal", value: true }),
  }));
  const lock = Object.freeze({
    kind: "member" as const,
    receiver: state,
    name: module.lifecycleLockName,
  });
  return Object.freeze({
    kind: "function",
    name: module.initializeName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: module.asynchronous,
    raises: module.raises,
    ...(module.errorType === undefined ? {} : { errorType: module.errorType }),
    statements: Object.freeze([
      Object.freeze({ kind: "variable", name: stateName, initializer: statePointer }),
      Object.freeze({
        kind: "with",
        expression: Object.freeze({
          kind: "construct",
          type: scopedLockType,
          arguments: Object.freeze([Object.freeze({ value: lock })]),
        }),
        statements: Object.freeze([
          Object.freeze({
            kind: "if",
            condition: Object.freeze({
              kind: "member",
              receiver: state,
              name: module.lifecycleInitializedName,
            }),
            thenStatements: Object.freeze([Object.freeze({ kind: "return" })]),
          }),
          ...initialization,
        ]),
      }),
    ]),
  });
}

function planModuleInitializationSteps(
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
  index: number,
): readonly MojoStatement[] | undefined {
  const step = module.initializationSteps[index];
  if (step === undefined) return Object.freeze([]);
  const diagnosticCount = context.diagnostics.length;
  const current = step.kind === "binding"
    ? planModuleBindingInitialization(step.binding, context)
    : step.kind === "statement"
      ? planModuleStatement(step.statement, context)
      : planMojoStatementRegion(step.statements, context);
  if (current === undefined) {
    appendPlanningFailure(
      context,
      diagnosticCount,
      "MOJO_MODULE_INITIALIZATION_STEP_NOT_PLANNED",
      step.kind === "binding"
        ? `Top-level binding '${step.binding.sourceName}' has no exact runtime initialization plan.`
        : "A top-level executable statement has no exact Mojo initialization plan.",
      step.kind === "binding"
        ? step.binding.initializer
        : step.kind === "statement"
          ? step.statement
          : step.statements[0] ?? module.sourceFile,
    );
    return undefined;
  }
  const remainder = planModuleInitializationSteps(module, context, index + 1);
  if (remainder === undefined) return undefined;
  if (step.kind !== "binding" ||
    (step.binding.declarationKind !== "using" && step.binding.declarationKind !== "await using")) {
    return Object.freeze([...current, ...remainder]);
  }
  const scoped = planMojoResourceScope(step.binding.declaration, remainder, context);
  return scoped === undefined ? undefined : Object.freeze([...current, ...scoped]);
}

function planModuleStatement(
  statement: import("@tsonic/tsts").Node,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const { ast } = context.program.source;
  const sourceExpression = Node_Expression(ast, statement);
  if (sourceExpression === undefined) return Object.freeze([]);
  const assignment = planMojoAssignment(sourceExpression, context);
  if (assignment !== undefined) return Object.freeze([
    ...assignment.before,
    assignment.statement,
  ]);
  const update = planMojoUpdate(sourceExpression, context);
  if (update !== undefined) return Object.freeze([
    ...update.before,
    update.statement,
  ]);
  const value = planMojoValue(sourceExpression, context);
  return value === undefined
    ? undefined
    : Object.freeze([...value.before, Object.freeze({ kind: "expression", expression: value.value })]);
}

function planModuleBindingInitialization(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (binding.storage !== "cell") return Object.freeze([]);
  const value = planMojoValue(binding.initializer, context, binding.type);
  const slot = mojoModuleBindingSlot(binding, context);
  if (value === undefined || slot === undefined) return undefined;
  registerMojoTypeImports(binding.type, context);
  return Object.freeze([...value.before, Object.freeze({
    kind: "assignment",
    operator: "=",
    left: slot,
    right: Object.freeze({
      kind: "construct",
      type: optionalType(binding.type),
      arguments: Object.freeze([Object.freeze({ value: value.value })]),
    }),
  })]);
}

function planComptimeBinding(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoComptimeDeclaration | undefined {
  const value = planMojoValue(binding.initializer, context, binding.type);
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

function optionalType(value: MojoTargetTypeRef): MojoTargetTypeRef {
  return Object.freeze({ kind: "optional", value });
}

function construct(type: MojoTargetTypeRef): MojoExpression {
  return Object.freeze({ kind: "construct", type, arguments: Object.freeze([]) });
}

function emptyModuleBinding(binding: MojoAnalyzedModuleBinding): MojoExpression {
  return construct(optionalType(binding.type));
}

function appendPlanningFailure(
  context: MojoPlanningContext,
  previousDiagnosticCount: number,
  code: string,
  message: string,
  sourceNode: import("@tsonic/tsts").Node,
): void {
  if (context.diagnostics.length !== previousDiagnosticCount) return;
  context.diagnostics.push(Object.freeze({
    code,
    category: "error" as const,
    source: "tsonic-mojo",
    message,
    sourceNode,
    evidence: Object.freeze(["target.capability=mojo.backend.module-initialization"]),
  }));
}
