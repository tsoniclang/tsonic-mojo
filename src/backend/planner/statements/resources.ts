import type { Node } from "@tsonic/tsts";
import type {
  MojoResourceDisposalAlternative,
  MojoResourceDisposalSelection,
  MojoResourceManagementSelection,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type { MojoExpression, MojoStatement } from "../../target-ast/index.js";
import { mojoModuleBindingRead } from "../bindings/module-bindings.js";
import type { MojoPlanningContext } from "../program/context.js";
import {
  allocateMojoSyntheticName,
  mojoModuleMemberExpression,
  mojoModulePathExpression,
} from "../program/context.js";
import { registerMojoTypeImports } from "../types/imports.js";
import { consumeMojoValue } from "../expressions/value-plan.js";

export function planMojoResourceScope(
  declaration: Node,
  protectedStatements: readonly MojoStatement[],
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  const selection = context.program.queries.resourceManagementSelection(declaration);
  if (selection === undefined) return undefined;
  const binding = resourceBinding(selection, context);
  if (binding === undefined) return undefined;
  const receiver = selection.storageMode === "optional"
    ? Object.freeze({
        kind: "method-call" as const,
        receiver: binding,
        name: "value",
        arguments: Object.freeze([]),
      })
    : binding;
  const cleanup = disposalStatements(selection, receiver, context);
  if (cleanup === undefined) return undefined;
  const guardedCleanup: readonly MojoStatement[] = selection.storageMode === "optional"
    ? Object.freeze([Object.freeze({
        kind: "if" as const,
        condition: binding,
        thenStatements: cleanup,
      })])
    : cleanup;
  if (!disposalRaises(selection)) {
    return Object.freeze([Object.freeze({
      kind: "try",
      statements: Object.freeze(protectedStatements),
      catches: Object.freeze([]),
      finallyStatements: guardedCleanup,
    })]);
  }
  return planRaisingResourceScope(protectedStatements, guardedCleanup, context);
}

function resourceBinding(
  selection: MojoResourceManagementSelection,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const moduleBinding = context.program.queries.moduleBinding(selection.declaration);
  return moduleBinding === undefined
    ? Object.freeze({ kind: "path", path: selection.bindingName })
    : mojoModuleBindingRead(moduleBinding, context);
}

function disposalStatements(
  selection: MojoResourceManagementSelection,
  receiver: MojoExpression,
  context: MojoPlanningContext,
): readonly MojoStatement[] | undefined {
  if (selection.alternatives.length === 1 && selection.storageMode !== "nullish-union" &&
    selection.resourceType.kind !== "union") {
    const expression = disposalExpression(selection.alternatives[0]!, receiver, context);
    return expression === undefined
      ? undefined
      : Object.freeze([Object.freeze({ kind: "expression", expression })]);
  }
  const members = selection.resourceType.kind === "union"
    ? selection.resourceType.members
    : Object.freeze([selection.resourceType]);
  if (selection.alternatives.length !== members.length) return undefined;
  let branch: readonly MojoStatement[] | undefined = selection.storageMode === "nullish-union"
    ? Object.freeze([])
    : undefined;
  for (let index = selection.alternatives.length - 1; index >= 0; index -= 1) {
    const alternative = selection.alternatives[index]!;
    registerMojoTypeImports(alternative.resourceType, context);
    const memberReceiver: MojoExpression = Object.freeze({
      kind: "proven-union-member",
      receiver,
      type: alternative.resourceType,
    });
    const expression = disposalExpression(alternative, memberReceiver, context);
    if (expression === undefined) return undefined;
    const statement: MojoStatement = Object.freeze({ kind: "expression", expression });
    if (branch === undefined) {
      branch = Object.freeze([statement]);
      continue;
    }
    branch = Object.freeze([Object.freeze({
      kind: "if",
      condition: Object.freeze({
        kind: "method-call",
        receiver,
        name: "isa",
        genericArguments: Object.freeze([Object.freeze({
          kind: "type",
          type: alternative.resourceType,
        })]),
        arguments: Object.freeze([]),
      }),
      thenStatements: Object.freeze([statement]),
      elseStatements: branch,
    })]);
  }
  return branch;
}

function disposalExpression(
  alternative: MojoResourceDisposalAlternative,
  receiver: MojoExpression,
  context: MojoPlanningContext,
): MojoExpression | undefined {
  const disposal = alternative.disposal;
  let call: MojoExpression;
  if (disposal.kind === "project") {
    call = Object.freeze({
      kind: "method-call",
      receiver,
      name: disposal.name,
      arguments: Object.freeze([]),
    });
  } else {
    const target = disposal.operation.target;
    if (target.kind === "instance-call") {
      call = Object.freeze({
        kind: "method-call",
        receiver: consumedReceiver(
          receiver,
          alternative.resourceType,
          target.receiver,
          context,
        ),
        name: target.name,
        arguments: Object.freeze([]),
      });
    } else if (target.kind === "function-call" && target.receiver !== undefined) {
      call = Object.freeze({
        kind: "call",
        callee: mojoModulePathExpression(
          context,
          target.modulePath,
          Object.freeze([...(target.ownerPath ?? []), target.name]),
        ),
        arguments: Object.freeze([Object.freeze({
          value: consumedReceiver(
            receiver,
            alternative.resourceType,
            target.receiver,
            context,
          ),
        })]),
      });
    } else {
      return undefined;
    }
  }
  if (!disposal.asynchronous) return call;
  const taskFactory = selectedDisposalRaises(disposal)
    ? "create_raising_task"
    : "create_task";
  return Object.freeze({
    kind: "await",
    expression: Object.freeze({
      kind: "call",
      callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], taskFactory),
      arguments: Object.freeze([Object.freeze({ value: call })]),
    }),
  });
}

function planRaisingResourceScope(
  protectedStatements: readonly MojoStatement[],
  cleanup: readonly MojoStatement[],
  context: MojoPlanningContext,
): readonly MojoStatement[] {
  const priorErrorName = allocateMojoSyntheticName(context, "resource_error");
  const caughtErrorName = allocateMojoSyntheticName(context, "caught_resource_error");
  const cleanupErrorName = allocateMojoSyntheticName(context, "cleanup_error");
  const errorType = mojoErrorType();
  const optionalErrorType: MojoTargetTypeRef = Object.freeze({ kind: "optional", value: errorType });
  registerMojoTypeImports(optionalErrorType, context);
  const priorError = Object.freeze({ kind: "path" as const, path: priorErrorName });
  const cleanupError = Object.freeze({ kind: "path" as const, path: cleanupErrorName });
  const composed = Object.freeze({
    kind: "call" as const,
    callee: mojoModuleMemberExpression(context, ["tsonic_runtime"], "suppressed_error"),
    arguments: Object.freeze([
      Object.freeze({ value: cleanupError }),
      Object.freeze({
        value: Object.freeze({
          kind: "method-call" as const,
          receiver: priorError,
          name: "value",
          arguments: Object.freeze([]),
        }),
      }),
    ]),
  });
  const cleanupWithComposition: MojoStatement = Object.freeze({
    kind: "try",
    statements: cleanup,
    catches: Object.freeze([Object.freeze({
      name: cleanupErrorName,
      statements: Object.freeze([Object.freeze({
        kind: "if",
        condition: priorError,
        thenStatements: Object.freeze([Object.freeze({ kind: "raise", expression: composed })]),
        elseStatements: Object.freeze([Object.freeze({ kind: "raise", expression: cleanupError })]),
      })]),
    })]),
  });
  return Object.freeze([
    Object.freeze({
      kind: "variable",
      name: priorErrorName,
      type: optionalErrorType,
      initializer: Object.freeze({ kind: "none-literal" }),
    }),
    Object.freeze({
      kind: "try",
      statements: Object.freeze(protectedStatements),
      catches: Object.freeze([Object.freeze({
        name: caughtErrorName,
        statements: Object.freeze([
          Object.freeze({
            kind: "assignment",
            operator: "=",
            left: priorError,
            right: Object.freeze({
              kind: "construct",
              type: optionalErrorType,
              arguments: Object.freeze([Object.freeze({
                value: Object.freeze({ kind: "path", path: caughtErrorName }),
              })]),
            }),
          }),
          Object.freeze({
            kind: "raise",
            expression: Object.freeze({ kind: "path", path: caughtErrorName }),
          }),
        ]),
      })]),
      finallyStatements: Object.freeze([cleanupWithComposition]),
    }),
  ]);
}

function consumedReceiver(
  receiver: MojoExpression,
  type: MojoTargetTypeRef,
  convention: "imm" | "mut" | "var" | "ref" | "out" | "deinit",
  context: MojoPlanningContext,
): MojoExpression {
  return convention === "var" || convention === "deinit"
    ? consumeMojoValue(receiver, type, context.program.lifecycle)
    : receiver;
}

function disposalRaises(selection: MojoResourceManagementSelection): boolean {
  return selection.alternatives.some(({ disposal }) => selectedDisposalRaises(disposal));
}

function selectedDisposalRaises(disposal: MojoResourceDisposalSelection): boolean {
  return disposal.kind === "project" ? disposal.raises : disposal.operation.raises;
}

function mojoErrorType(): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: "mojo.builtin.Error",
    modulePath: Object.freeze([]),
    name: "Error",
  });
}
