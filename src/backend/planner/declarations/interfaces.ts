import type {
  MojoAnalyzedInterface,
} from "../../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../../target-model/types/model.js";
import type {
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../../target-ast/index.js";
import type { MojoPlanningContext } from "../program/context.js";
import { registerMojoTypeImports } from "../types/render.js";

export function planMojoInterface(
  interface_: MojoAnalyzedInterface,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] {
  const genericParameters = Object.freeze(interface_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    name: parameter.name,
    position: "positional-or-keyword" as const,
    variadic: false,
    constraints: parameter.constraints,
  })));
  const genericArguments = interface_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    type: Object.freeze({ kind: "type-parameter" as const, name: parameter.name }),
  }));
  const stateType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: `${interface_.targetType.kind === "target-named" ? interface_.targetType.id : interface_.name}:state`,
    modulePath: Object.freeze([]),
    name: interface_.stateName,
    ...(genericArguments.length === 0 ? {} : { genericArguments: Object.freeze(genericArguments) }),
  });
  const arcType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: "mojo.std.memory.ArcPointer",
    modulePath: Object.freeze(["std", "memory"]),
    name: "ArcPointer",
    genericArguments: Object.freeze([{ kind: "type" as const, type: stateType }]),
  });
  registerMojoTypeImports(arcType, context);
  for (const field of interface_.fields) registerMojoTypeImports(field.type, context);
  const state: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: interface_.stateName,
    genericParameters,
    conformances: Object.freeze([]),
    fields: Object.freeze(interface_.fields.map((field) => Object.freeze({
      name: field.name,
      type: field.type,
      compileTime: false,
    }))),
    methods: Object.freeze([]),
    decorators: Object.freeze(["fieldwise_init"]),
  });
  const stateConstruction = Object.freeze({
    kind: "construct" as const,
    type: stateType,
    arguments: Object.freeze(interface_.fields.map((field) => Object.freeze({
      value: Object.freeze({ kind: "path" as const, path: field.name }),
    }))),
  });
  const initialize: MojoStatement = Object.freeze({
    kind: "assignment",
    operator: "=",
    left: Object.freeze({
      kind: "member",
      receiver: Object.freeze({ kind: "path", path: "self" }),
      name: "_state",
    }),
    right: Object.freeze({
      kind: "construct",
      type: arcType,
      arguments: Object.freeze([{ value: stateConstruction }]),
    }),
  });
  const constructor: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze(interface_.fields.map((field) => Object.freeze({
      name: field.name,
      type: field.type,
      convention: "imm" as const,
    }))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: false,
    self: "out self",
    statements: Object.freeze([initialize]),
  });
  const wrapper: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: interface_.name,
    genericParameters,
    conformances: Object.freeze([Object.freeze({
      kind: "target-named",
      id: "mojo.builtin.Copyable",
      modulePath: Object.freeze([]),
      name: "Copyable",
    })]),
    fields: Object.freeze([Object.freeze({
      name: "_state",
      type: arcType,
      compileTime: false,
    })]),
    methods: Object.freeze([constructor]),
  });
  return Object.freeze([state, wrapper]);
}
