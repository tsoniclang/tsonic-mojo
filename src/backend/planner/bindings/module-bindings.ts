import type {
  MojoAnalyzedModule,
  MojoAnalyzedModuleBinding,
} from "../../../analysis/program/model.js";
import type { MojoExpression } from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { mojoQualifiedModuleMember } from "../program/context.js";

export function mojoModuleBindingRead(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  if (binding.storage === "comptime") {
    const owner = context.program.modules.forSourceFile(binding.sourceFile);
    return owner === undefined
      ? undefined
      : Object.freeze({
          kind: "path",
          path: mojoQualifiedModuleMember(context, owner.modulePath, binding.name),
        });
  }
  const slot = mojoModuleBindingSlot(binding, context);
  return slot === undefined
    ? undefined
    : Object.freeze({
        kind: "method-call",
        receiver: slot,
        name: "value",
        arguments: Object.freeze([]),
      });
}

export function mojoModuleBindingWrite(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  return binding.storage === "cell"
    ? mojoModuleBindingRead(binding, context)
    : undefined;
}

export function mojoModuleBindingSlot(
  binding: MojoAnalyzedModuleBinding,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const owner = context.program.modules.forSourceFile(binding.sourceFile);
  const module = owner === undefined ? undefined : context.program.queries.moduleForId(owner.id);
  if (module === undefined || owner === undefined) return undefined;
  return Object.freeze({
    kind: "member",
    receiver: moduleState(context, module, owner.modulePath),
    name: binding.name,
  });
}

export function mojoModuleStateExpression(
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const owner = context.program.modules.forSourceFile(module.sourceFile);
  return owner === undefined ? undefined : moduleState(context, module, owner.modulePath);
}

export function mojoModuleStatePointerExpression(
  module: MojoAnalyzedModule,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const owner = context.program.modules.forSourceFile(module.sourceFile);
  return owner === undefined ? undefined : moduleStatePointer(context, module, owner.modulePath);
}

function moduleState(
  context: MojoPlanningContext,
  module: MojoAnalyzedModule,
  modulePath: readonly string[],
): MojoExpression {
  return Object.freeze({
    kind: "postfix-deref",
    expression: moduleStatePointer(context, module, modulePath),
  });
}

function moduleStatePointer(
  context: MojoPlanningContext,
  module: MojoAnalyzedModule,
  modulePath: readonly string[],
): MojoExpression {
  const cell: MojoExpression = Object.freeze({
    kind: "path",
    path: mojoQualifiedModuleMember(context, modulePath, module.cellName),
  });
  return Object.freeze({
    kind: "method-call",
    receiver: cell,
    name: "get",
    arguments: Object.freeze([]),
  });
}
