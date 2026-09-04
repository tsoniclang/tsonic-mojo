import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
  MojoModuleInitializationComponent,
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
import { mojoFieldwiseInitDecorators } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "./context.js";
import {
  allocateMojoSyntheticName,
  mojoModuleMemberExpression,
  registerMojoSymbolImport,
  withMojoErrorType,
  withMojoModuleStateInitialization,
} from "./context.js";
import {
  planMojoValue,
} from "../expressions/value.js";
import { mojoModuleBindingSlot, mojoModuleStatePointerExpression } from "../bindings/module-bindings.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { planMojoStatementRegion } from "../statements/structured.js";
import { planMojoResourceScope } from "../statements/resources.js";
import { adaptMojoValueErrorDomain } from "../expressions/error-domains.js";
import { consumeMojoValue, mojoValue } from "../expressions/value-plan.js";
import { planMojoProjectFunction } from "../declarations/project.js";
import { planMojoCompileTimeInitializer } from "../compile-time/values.js";
import { planMojoFunctionValue } from "./function-values.js";
import { planMojoBindingProjection } from "../bindings/patterns.js";

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
    appendPlanningFailure(
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
  for (const binding of directFunctionBindings) {
    const diagnosticCount = context.diagnostics.length;
    const declaration = planDirectFunctionBinding(binding, context);
    if (declaration === undefined) {
      appendPlanningFailure(
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
      appendPlanningFailure(
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
      appendPlanningFailure(
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
        type: optionalType(binding.type),
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

function planModuleInitializerBody(
  module: MojoAnalyzedModule,
  stateRequired: boolean,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (module.directErrorType !== undefined) registerMojoTypeImports(module.directErrorType, context);
  const moduleContext = withMojoErrorType(context, module.directErrorType);
  if (!stateRequired) {
    const statements = planModuleInitializationSteps(module, moduleContext, 0);
    if (statements === undefined) return undefined;
    return Object.freeze({
      kind: "function",
      name: module.initializeBodyName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: module.directAsynchronous,
      raises: module.directRaises,
      ...(module.directErrorType === undefined ? {} : { errorType: module.directErrorType }),
      statements,
    });
  }
  const stateName = allocateMojoSyntheticName(context, "state");
  const statePointer = mojoModuleStatePointerExpression(module, context);
  if (statePointer === undefined) {
    appendPlanningFailure(
      context,
      context.diagnostics.length,
      "MOJO_MODULE_STATE_OWNER_NOT_PLANNED",
      `Source module '${context.module.relativeSourcePath}' has no exact module-state owner.`,
      module.sourceFile,
    );
    return undefined;
  }
  const state = Object.freeze({
    kind: "postfix-deref" as const,
    expression: Object.freeze({ kind: "path" as const, path: stateName }),
  });
  const initializingContext = withMojoModuleStateInitialization(
    moduleContext,
    module.id,
    Object.freeze({ kind: "path", path: stateName }),
    state,
  );
  const sourceInitialization = planModuleInitializationSteps(module, initializingContext, 0);
  if (sourceInitialization === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: module.initializeBodyName,
    genericParameters: Object.freeze([]),
    parameters: Object.freeze([]),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: module.directAsynchronous,
    raises: module.directRaises,
    ...(module.directErrorType === undefined ? {} : { errorType: module.directErrorType }),
    statements: Object.freeze([
      Object.freeze({ kind: "variable", name: stateName, initializer: statePointer }),
      ...sourceInitialization,
    ]),
  });
}

function planInitializationComponent(
  program: MojoTargetProgram,
  component: MojoModuleInitializationComponent,
  module: MojoAnalyzedModule,
  scopedLockType: MojoTargetTypeRef | undefined,
  context: MojoPlanningContext,
): MojoFunctionDeclaration | undefined {
  if (component.errorType !== undefined) registerMojoTypeImports(component.errorType, context);
  const componentContext = withMojoErrorType(context, component.errorType);
  const initialization = planComponentInitializationSequence(
    program,
    component,
    componentContext,
  );
  if (initialization === undefined) return undefined;
  if (!component.directRuntimeInitializationRequired) {
    return Object.freeze({
      kind: "function",
      name: module.initializeName,
      genericParameters: Object.freeze([]),
      parameters: Object.freeze([]),
      resultType: Object.freeze({ kind: "unit" }),
      asynchronous: component.asynchronous,
      raises: component.raises,
      ...(component.errorType === undefined ? {} : { errorType: component.errorType }),
      statements: initialization,
    });
  }
  if (scopedLockType === undefined) return undefined;
  const stateName = allocateMojoSyntheticName(context, "state");
  const statePointer = mojoModuleStatePointerExpression(module, context);
  if (statePointer === undefined) return undefined;
  const state = Object.freeze({
    kind: "postfix-deref" as const,
    expression: Object.freeze({ kind: "path" as const, path: stateName }),
  });
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
    asynchronous: component.asynchronous,
    raises: component.raises,
    ...(component.errorType === undefined ? {} : { errorType: component.errorType }),
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
          Object.freeze({
            kind: "assignment",
            operator: "=",
            left: Object.freeze({
              kind: "member",
              receiver: state,
              name: module.lifecycleInitializedName,
            }),
            right: Object.freeze({ kind: "bool-literal", value: true }),
          }),
        ]),
      }),
    ]),
  });
}

function planComponentInitializationSequence(
  program: MojoTargetProgram,
  component: MojoModuleInitializationComponent,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const initialization: MojoStatement[] = [];
  for (const dependencyId of component.dependencyComponentIds) {
    const dependency = program.moduleInitialization.componentForId(dependencyId);
    if (dependency === undefined || !dependency.runtimeInitializationRequired) continue;
    const owner = program.queries.moduleForId(dependency.ownerModuleId);
    const definition = owner === undefined
      ? undefined
      : program.modules.forSourceFile(owner.sourceFile);
    if (owner === undefined || definition === undefined) return undefined;
    const statements = planInitializationCall(
      mojoModuleMemberExpression(context, definition.modulePath, owner.initializeName),
      dependency.asynchronous,
      dependency.raises,
      dependency.errorType,
      component.errorType,
      owner.sourceFile,
      context,
    );
    if (statements === undefined) return undefined;
    initialization.push(...statements);
  }
  for (const memberId of component.memberModuleIds) {
    const member = program.queries.moduleForId(memberId);
    if (member === undefined || !member.directRuntimeInitializationRequired) continue;
    const definition = program.modules.forSourceFile(member.sourceFile);
    if (definition === undefined) return undefined;
    const statements = planInitializationCall(
      mojoModuleMemberExpression(context, definition.modulePath, member.initializeBodyName),
      member.directAsynchronous,
      member.directRaises,
      member.directErrorType,
      component.errorType,
      member.sourceFile,
      context,
    );
    if (statements === undefined) return undefined;
    initialization.push(...statements);
  }
  return Object.freeze(initialization);
}

function planInitializationCall(
  callee: MojoExpression,
  asynchronous: boolean,
  raises: boolean,
  sourceErrorType: MojoTargetTypeRef | undefined,
  targetErrorType: MojoTargetTypeRef | undefined,
  sourceNode: import("@tsonic/tsts").Node,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const call: MojoExpression = Object.freeze({
    kind: "call",
    callee,
    arguments: Object.freeze([]),
  });
  const expression: MojoExpression = asynchronous
    ? Object.freeze({
        kind: "await",
        expression: Object.freeze({
          kind: "call",
          callee: mojoModuleMemberExpression(
            context,
            ["tsonic_runtime"],
            raises ? "create_raising_task" : "create_task",
          ),
          arguments: Object.freeze([Object.freeze({ value: call })]),
        }),
      })
    : call;
  const adapted = adaptMojoValueErrorDomain(
    mojoValue(expression),
    Object.freeze({ kind: "unit" }),
    sourceErrorType,
    targetErrorType,
    sourceNode,
    context,
  );
  if (adapted === undefined) return undefined;
  return Object.freeze([
    ...adapted.before,
    ...(adapted.value.kind === "tuple" && adapted.value.elements.length === 0
      ? []
      : [Object.freeze({ kind: "expression" as const, expression: adapted.value })]),
  ]);
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
    : step.kind === "binding-pattern"
      ? planModuleBindingPatternInitialization(step, context)
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
        : step.kind === "binding-pattern"
          ? "A top-level binding pattern has no exact runtime projection plan."
        : "A top-level executable statement has no exact Mojo initialization plan.",
      step.kind === "binding"
        ? step.binding.initializer
        : step.kind === "binding-pattern"
          ? step.initializer
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

function planModuleBindingPatternInitialization(
  step: Extract<import("../../../analysis/program/model.js").MojoModuleInitializationStep, {
    readonly kind: "binding-pattern";
  }>,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const projection = context.program.queries.bindingProjection(step.declaration);
  const source = planMojoValue(step.initializer, context, step.sourceType);
  if (projection === undefined || source === undefined) return undefined;
  const projected = planMojoBindingProjection(
    projection,
    source,
    "stabilized",
    context,
    planMojoValue,
  );
  if (projected === undefined) return undefined;
  const assignments: MojoStatement[] = [...projected];
  for (const binding of step.bindings) {
    if (binding.disposition.kind !== "immutable-runtime" && binding.disposition.kind !== "live-cell") {
      return undefined;
    }
    const slot = mojoModuleBindingSlot(binding, context);
    if (slot === undefined) return undefined;
    registerMojoTypeImports(binding.type, context);
    assignments.push(Object.freeze({
      kind: "assignment",
      operator: "=",
      left: slot,
      right: Object.freeze({
        kind: "construct",
        type: optionalType(binding.type),
        arguments: Object.freeze([Object.freeze({
          value: consumeMojoValue(
            Object.freeze({ kind: "path", path: binding.name }),
            binding.type,
            context.program.lifecycle,
          ),
        })]),
      }),
    }));
  }
  return Object.freeze(assignments);
}

function planModuleStatement(
  statement: import("@tsonic/tsts").Node,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  return planMojoStatementRegion(Object.freeze([statement]), context);
}

function planModuleBindingInitialization(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (binding.disposition.kind !== "immutable-runtime" &&
    binding.disposition.kind !== "live-cell") return Object.freeze([]);
  const value = binding.kind === "function-value"
    ? planMojoFunctionValue(binding, context)
    : planMojoValue(binding.initializer, context, binding.type);
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
