import { rejectedTargetStage, resolvedTargetStage } from "@tsonic/target-api/artifacts";
import type { TargetStageResult } from "@tsonic/target-api/artifacts";
import type { MojoOutputPlan } from "../artifact-model/output.js";
import type {
  MojoDeclaration,
  MojoFunctionDeclaration,
  MojoStatement,
  MojoStructDeclaration,
} from "../target-ast/nodes.js";
import type { MojoPlanningContext } from "./context.js";
import { planMojoExpression } from "./expressions.js";
import { planMojoFunctionStatements } from "./statements.js";
import { registerMojoTypeImports } from "./types/render.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
} from "../../analysis/program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/provider/model.js";

export function planMojoOutput(context: MojoPlanningContext): TargetStageResult<MojoOutputPlan> {
  const declarations: MojoDeclaration[] = [];
  for (const declaration of context.program.declarations) {
    if (declaration.kind === "class") {
      const planned = planClass(declaration, context);
      if (planned !== undefined) declarations.push(...planned);
      continue;
    }
    const planned = planFunction(declaration, context);
    if (planned !== undefined) declarations.push(planned);
  }
  if (context.diagnostics.length > 0) return rejectedTargetStage(context.diagnostics);
  return resolvedTargetStage(Object.freeze({
    configuration: context.program.configuration,
    module: Object.freeze({
      imports: Object.freeze([...context.imports.entries()]
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([, declaration]) => declaration)),
      declarations: Object.freeze(declarations),
    }),
    runtimePackages: context.program.runtimePackages,
  }));
}

function planFunction(
  function_: MojoAnalyzedFunction,
  context: MojoPlanningContext,
  self?: MojoFunctionDeclaration["self"],
): MojoFunctionDeclaration | undefined {
  for (const parameter of function_.parameters) registerMojoTypeImports(parameter.type, context);
  registerMojoTypeImports(function_.resultType, context);
  const statements = planMojoFunctionStatements(function_, context);
  if (statements === undefined) return undefined;
  return Object.freeze({
    kind: "function",
    name: function_.name,
    genericParameters: genericParameters(function_),
    parameters: Object.freeze(function_.parameters.map((parameter) => Object.freeze({
      name: parameter.name,
      type: parameter.type,
      convention: parameter.convention,
      variadic: parameter.rest,
      ...(parameter.optional && parameter.initializer === undefined
        ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
        : {}),
    }))),
    resultType: function_.resultType,
    asynchronous: function_.asynchronous,
    raises: function_.raises,
    statements,
    ...(self === undefined ? {} : { self }),
  });
}

function planClass(
  class_: MojoAnalyzedClass,
  context: MojoPlanningContext,
): readonly MojoStructDeclaration[] | undefined {
  const genericParameters_ = genericParameters(class_);
  const genericArguments = class_.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    type: Object.freeze({ kind: "type-parameter" as const, name: parameter.name }),
  }));
  const stateType: MojoTargetTypeRef = Object.freeze({
    kind: "target-named",
    id: `${class_.targetType.kind === "target-named" ? class_.targetType.id : class_.name}:state`,
    modulePath: Object.freeze([]),
    name: class_.stateName,
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
  for (const field of class_.fields) registerMojoTypeImports(field.type, context);
  const state: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.stateName,
    genericParameters: genericParameters_,
    conformances: Object.freeze([]),
    fields: Object.freeze(class_.fields.map((field) => Object.freeze({
      name: field.name,
      type: field.type,
      compileTime: false,
    }))),
    methods: Object.freeze([]),
    decorators: Object.freeze(["fieldwise_init"]),
  });
  const sourceConstructor = class_.constructors[0];
  const fieldArguments = class_.fields.map((field) => {
    const value = planMojoExpression(field.initializer, context, field.type);
    return value === undefined ? undefined : Object.freeze({ value });
  });
  if (fieldArguments.some((argument) => argument === undefined)) return undefined;
  const stateConstruction = Object.freeze({
    kind: "construct" as const,
    type: stateType,
    arguments: Object.freeze(fieldArguments as NonNullable<typeof fieldArguments[number]>[]),
  });
  const arcConstruction = Object.freeze({
    kind: "construct" as const,
    type: arcType,
    arguments: Object.freeze([{ value: stateConstruction }]),
  });
  const initializeState: MojoStatement = Object.freeze({
    kind: "assignment",
    operator: "=",
    left: Object.freeze({
      kind: "member",
      receiver: Object.freeze({ kind: "path", path: "self" }),
      name: "_state",
    }),
    right: arcConstruction,
  });
  let constructorStatements: readonly MojoStatement[] = Object.freeze([]);
  if (sourceConstructor !== undefined) {
    const planned = planMojoFunctionStatements(sourceConstructor, context);
    if (planned === undefined) return undefined;
    constructorStatements = planned;
  }
  const constructor: MojoFunctionDeclaration = Object.freeze({
    kind: "function",
    name: "__init__",
    genericParameters: Object.freeze([]),
    parameters: Object.freeze((sourceConstructor?.parameters ?? []).map((parameter) => Object.freeze({
      name: parameter.name,
      type: parameter.type,
      convention: parameter.convention,
      variadic: parameter.rest,
      ...(parameter.optional && parameter.initializer === undefined
        ? { defaultValue: Object.freeze({ kind: "none-literal" as const }) }
        : {}),
    }))),
    resultType: Object.freeze({ kind: "unit" }),
    asynchronous: false,
    raises: sourceConstructor?.raises === true,
    self: "out self",
    statements: Object.freeze([initializeState, ...constructorStatements]),
  });
  const methods: MojoFunctionDeclaration[] = [constructor];
  for (const method of class_.methods) {
    const planned = planFunction(method, context, method.static === true ? undefined : "self");
    if (planned === undefined) return undefined;
    methods.push(planned);
  }
  const wrapper: MojoStructDeclaration = Object.freeze({
    kind: "struct",
    name: class_.name,
    genericParameters: genericParameters_,
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
    methods: Object.freeze(methods),
  });
  return Object.freeze([state, wrapper]);
}

function genericParameters(
  declaration: Pick<MojoAnalyzedFunction | MojoAnalyzedClass, "typeParameters">,
) {
  return Object.freeze(declaration.typeParameters.map((parameter) => Object.freeze({
    kind: "type" as const,
    name: parameter.name,
    position: "positional-or-keyword" as const,
    variadic: false,
    constraints: parameter.constraints,
  })));
}
