import type {
  ProviderParameterDeclaration,
  ProviderTypeExpression,
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type {
  MojoCompilerGenericParameter,
  MojoCompilerPackageSnapshot,
  MojoCompilerProjectSnapshot,
  MojoCompilerType,
  MojoCompilerTypeArgument,
} from "../model/model.js";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../../target-model/provider/model.js";
import { compilerModuleIdentity } from "../model/normalization.js";
import { mojoCompilerModuleSpecifier } from "./module-specifier.js";
import { projectMojoPassingMode } from "./call-conventions.js";

export interface MojoCompilerTypeProjection {
  readonly source: ProviderTypeExpression;
  readonly target: MojoTargetTypeRef;
}

export interface MojoCompilerTypeProjectionContext {
  readonly snapshot: MojoCompilerProjectSnapshot;
  readonly package: MojoCompilerPackageSnapshot;
  readonly modulePath: readonly string[];
  readonly localDeclarations: ReadonlySet<string>;
  readonly source: {
    readonly providerModuleId: string;
    readonly moduleSpecifier: string;
    readonly exportName: string;
  };
  readonly owner?: {
    readonly name: string;
    readonly sourceName: string;
    readonly exportId: string;
    readonly genericParameters: readonly MojoCompilerGenericParameter[];
  };
  readonly imports: Map<string, Set<string>>;
}

export function projectMojoCompilerType(
  type: MojoCompilerType,
  context: MojoCompilerTypeProjectionContext,
): MojoCompilerTypeProjection {
  switch (type.kind) {
    case "type-parameter":
      return Object.freeze({
        source: Object.freeze({ kind: "type-parameter", name: type.name }),
        target: Object.freeze({ kind: "type-parameter", name: type.name }),
      });
    case "self": {
      if (context.owner === undefined) {
        throw new Error(`Mojo associated self type '${["Self", ...type.memberPath].join(".")}' is not representable.`);
      }
      const moduleSpecifier = context.source.moduleSpecifier;
      const genericArguments = context.owner.genericParameters.map((parameter): MojoTargetGenericArgument =>
        parameter.kind === "type"
          ? Object.freeze({ kind: "type", type: Object.freeze({ kind: "type-parameter", name: parameter.name }) })
          : Object.freeze({ kind: "value", expression: parameter.name }));
      const ownerTarget = namedTargetType(
        context.package,
        context.modulePath,
        context.owner.name,
        genericArguments,
      );
      if (type.memberPath.length > 0) {
        const projectedArguments = type.arguments.map((argument) => projectGenericArgument(argument, context));
        return Object.freeze({
          source: Object.freeze({ kind: "object" }),
          target: Object.freeze({
            kind: "associated",
            owner: ownerTarget,
            memberPath: type.memberPath,
            genericArguments: Object.freeze(projectedArguments.map(({ target }) => target)),
          }),
        });
      }
      return Object.freeze({
        source: Object.freeze({
          kind: "provider-ref",
          moduleSpecifier,
          exportName: context.owner.sourceName,
          ...(context.owner.genericParameters.length === 0
            ? {}
            : {
                typeArguments: Object.freeze(context.owner.genericParameters.map((parameter) =>
                  Object.freeze({ kind: "type-parameter" as const, name: parameter.name }))),
              }),
        }),
        target: ownerTarget,
      });
    }
    case "associated": {
      const owner = projectMojoCompilerType(type.owner, context);
      const arguments_ = type.arguments.map((argument) => projectGenericArgument(argument, context));
      return Object.freeze({
        source: Object.freeze({ kind: "object" }),
        target: Object.freeze({
          kind: "associated",
          owner: owner.target,
          memberPath: type.memberPath,
          genericArguments: Object.freeze(arguments_.map(({ target }) => target)),
        }),
      });
    }
    case "tuple": {
      const elements = type.elements.map((element) => projectMojoCompilerType(element, context));
      return Object.freeze({
        source: Object.freeze({ kind: "tuple", elementTypes: Object.freeze(elements.map(({ source }) => source)) }),
        target: Object.freeze({ kind: "tuple", elements: Object.freeze(elements.map(({ target }) => target)) }),
      });
    }
    case "reference": {
      const target = projectMojoCompilerType(type.target, context);
      return Object.freeze({
        source: target.source,
        target: Object.freeze({ kind: "reference", origin: type.origin, value: target.target }),
      });
    }
    case "compiler-expression": return Object.freeze({
      source: Object.freeze({ kind: "object" }),
      target: Object.freeze({ kind: "compiler-expression", expression: type.expression }),
    });
    case "function": {
      const parameters = type.parameters.map((parameter) => Object.freeze({
        parameter,
        projected: projectMojoCompilerType(parameter.type, context),
      }));
      const result = type.result === undefined
        ? unitProjection
        : projectMojoCompilerType(type.result, context);
      const errorType = type.errorType === undefined
        ? undefined
        : projectMojoCompilerType(type.errorType, context);
      const id = `mojo-function:${JSON.stringify(type)}`;
      return Object.freeze({
        source: Object.freeze({
          kind: "function",
          id,
          parameters: Object.freeze(parameters.map(({ parameter, projected }, index): ProviderParameterDeclaration =>
            Object.freeze({
              name: parameter.name ?? `argument${index}`,
              type: projected.source,
              passingMode: projectMojoPassingMode(parameter.convention),
            }))),
          returnType: result.source,
          ...(type.genericParameters.length === 0
            ? {}
            : { typeParameters: projectMojoGenericParameters(type.genericParameters, context) }),
        }),
        target: Object.freeze({
          kind: "function",
          genericParameters: projectMojoTargetGenericParameters(type.genericParameters, context),
          parameters: Object.freeze(parameters.map(({ parameter, projected }) => Object.freeze({
            ...(parameter.name === undefined ? {} : { name: parameter.name }),
            convention: parameter.convention,
            type: projected.target,
          }))),
          result: result.target,
          asynchronous: type.asynchronous,
          thin: type.thin,
          raises: type.raises,
          ...(errorType === undefined ? {} : { errorType: errorType.target }),
          ...(type.capture === undefined ? {} : { capture: type.capture }),
        }),
      });
    }
    case "named": return projectNamedType(type, context);
  }
}

export function projectMojoTargetGenericParameters(
  parameters: readonly MojoCompilerGenericParameter[],
  context: MojoCompilerTypeProjectionContext,
): readonly MojoProviderTargetGenericParameter[] {
  return Object.freeze(parameters.map((parameter): MojoProviderTargetGenericParameter => Object.freeze({
    kind: parameter.kind,
    name: parameter.name,
    position: parameter.passingKind,
    variadic: parameter.variadic,
    constraints: Object.freeze(parameter.constraints.map((constraint) =>
      projectMojoCompilerType(constraint, context).target)),
    ...(parameter.defaultArgument === undefined
      ? {}
      : { defaultArgument: projectTargetGenericArgument(parameter.defaultArgument, context) }),
  })));
}

function projectTargetGenericArgument(
  argument: MojoCompilerTypeArgument,
  context: MojoCompilerTypeProjectionContext,
): MojoTargetGenericArgument {
  if (argument.kind === "type") {
    return Object.freeze({ kind: "type", type: projectMojoCompilerType(argument.type, context).target });
  }
  if (argument.kind === "value") {
    return Object.freeze({ kind: "value", expression: argument.expression });
  }
  if (argument.kind === "type-expression") {
    return Object.freeze({ kind: "type-expression", expression: argument.expression });
  }
  if (argument.kind === "compiler-expression") {
    return Object.freeze({ kind: "compiler-expression", expression: argument.expression });
  }
  return Object.freeze({ kind: "unbound" });
}

export function projectMojoGenericParameters(
  parameters: readonly MojoCompilerGenericParameter[],
  context: MojoCompilerTypeProjectionContext,
): readonly ProviderTypeParameterDeclaration[] {
  return Object.freeze(parameters.map((parameter): ProviderTypeParameterDeclaration => {
    const constraints = parameter.constraints.map((constraint) =>
      projectMojoCompilerType(constraint, context).source);
    const sourceConstraints = parameter.variadic
      ? [Object.freeze({
          kind: "array" as const,
          elementType: constraints.length === 1
            ? constraints[0]!
            : Object.freeze({ kind: "intersection" as const, types: Object.freeze(constraints) }),
        })]
      : constraints;
    const defaultArgument = parameter.defaultArgument === undefined
      ? undefined
      : projectGenericArgument(parameter.defaultArgument, context);
    if (defaultArgument !== undefined && defaultArgument.source === undefined) {
      throw new Error(`Mojo generic parameter '${parameter.name}' has an unbound default argument.`);
    }
    return Object.freeze({
      name: parameter.name,
      constraints: Object.freeze(sourceConstraints),
      ...(defaultArgument?.source === undefined ? {} : { defaultType: defaultArgument.source }),
    });
  }));
}

function projectNamedType(
  type: Extract<MojoCompilerType, { readonly kind: "named" }>,
  context: MojoCompilerTypeProjectionContext,
): MojoCompilerTypeProjection {
  const primitive = primitiveProjection(type.name);
  if (primitive !== undefined && type.arguments.length === 0) return primitive;
  const projectedArguments = type.arguments.map((argument) => projectGenericArgument(argument, context));
  const sourceArguments = projectedArguments.map(({ source }) => source);
  if (sourceArguments.some((argument) => argument === undefined)) {
    throw new Error(`Mojo type '${type.name}' contains an unbound generic argument.`);
  }
  const location = resolveTypeLocation(type, context);
  const physicalModuleSpecifier = mojoCompilerModuleSpecifier(location.package, location.modulePath);
  const currentOwner = context.owner !== undefined && type.name === context.owner.name;
  const directModule = physicalModuleSpecifier === context.source.moduleSpecifier;
  const moduleSpecifier = currentOwner || directModule
    ? context.source.moduleSpecifier
    : physicalModuleSpecifier;
  const sourceExportName = currentOwner ? context.owner!.sourceName : location.exportName;
  if (moduleSpecifier !== context.source.moduleSpecifier) {
    addImport(context.imports, moduleSpecifier, sourceExportName);
  }
  return Object.freeze({
    source: Object.freeze({
      kind: "provider-ref",
      moduleSpecifier,
      exportName: sourceExportName,
      ...(sourceArguments.length === 0
        ? {}
        : { typeArguments: Object.freeze(sourceArguments as ProviderTypeExpression[]) }),
    }),
    target: namedTargetType(
      location.package,
      location.modulePath,
      location.exportName,
      projectedArguments.map(({ target }) => target),
    ),
  });
}

function projectGenericArgument(
  argument: MojoCompilerTypeArgument,
  context: MojoCompilerTypeProjectionContext,
): { readonly source?: ProviderTypeExpression; readonly target: MojoTargetGenericArgument } {
  switch (argument.kind) {
    case "unbound": return Object.freeze({
      target: Object.freeze({ kind: "unbound", ...(argument.name === undefined ? {} : { name: argument.name }) }),
    });
    case "type": {
      const projected = projectMojoCompilerType(argument.type, context);
      return Object.freeze({
        source: projected.source,
        target: Object.freeze({
          kind: "type",
          ...(argument.name === undefined ? {} : { name: argument.name }),
          type: projected.target,
        }),
      });
    }
    case "type-expression": {
      const projected = projectMojoCompilerType(argument.sourceType, context);
      return Object.freeze({
        source: projected.source,
        target: Object.freeze({
          kind: "type-expression",
          ...(argument.name === undefined ? {} : { name: argument.name }),
          expression: argument.expression,
        }),
      });
    }
    case "compiler-expression": return Object.freeze({
      source: Object.freeze({ kind: "object" }),
      target: Object.freeze({
        kind: "compiler-expression",
        ...(argument.name === undefined ? {} : { name: argument.name }),
        expression: argument.expression,
      }),
    });
    case "value": {
      const source = sourceValueArgument(argument.expression);
      return Object.freeze({
        source,
        target: Object.freeze({
          kind: "value",
          ...(argument.name === undefined ? {} : { name: argument.name }),
          expression: argument.expression,
        }),
      });
    }
  }
}

function sourceValueArgument(expression: string): ProviderTypeExpression {
  if (/^-?[0-9]+(?:\.[0-9]+)?$/u.test(expression)) {
    return Object.freeze({ kind: "literal", value: Number(expression) });
  }
  if (expression === "True" || expression === "False") {
    return Object.freeze({ kind: "literal", value: expression === "True" });
  }
  if (expression === "None") return Object.freeze({ kind: "literal", value: null });
  if (/^[_A-Za-z][_A-Za-z0-9]*$/u.test(expression)) {
    return Object.freeze({ kind: "type-parameter", name: expression });
  }
  return Object.freeze({ kind: "literal", value: expression });
}

function resolveTypeLocation(
  type: Extract<MojoCompilerType, { readonly kind: "named" }>,
  context: MojoCompilerTypeProjectionContext,
): {
  readonly package: MojoCompilerPackageSnapshot;
  readonly modulePath: readonly string[];
  readonly exportName: string;
} {
  if (type.path === undefined) {
    if (context.localDeclarations.has(type.name)) {
      return { package: context.package, modulePath: context.modulePath, exportName: type.name };
    }
    throw new Error(`Mojo type '${type.name}' has no compiler-owned declaration path.`);
  }
  const segments = type.path.split("/").filter((segment) => segment.length > 0);
  const package_ = context.snapshot.packages.find((candidate) => candidate.packageName === segments[0]);
  if (package_ === undefined || segments.length < 2) {
    throw new Error(`Mojo type path '${type.path}' has no configured package owner.`);
  }
  const exportName = segments[segments.length - 1]!.replace(/^#/u, "");
  const pathSegments = segments.slice(1, -1);
  const module = [...package_.modules]
    .sort((left, right) => right.modulePath.length - left.modulePath.length)
    .find((candidate) => samePath(candidate.modulePath, pathSegments));
  if (module === undefined) {
    throw new Error(`Mojo type path '${type.path}' has no exact configured module owner.`);
  }
  return { package: package_, modulePath: module.modulePath, exportName };
}

function primitiveProjection(name: string): MojoCompilerTypeProjection | undefined {
  const sourcePrimitive = primitiveNames.get(name);
  if (sourcePrimitive !== undefined) {
    return Object.freeze({
      source: Object.freeze({ kind: "source-primitive", name: sourcePrimitive }),
      target: Object.freeze({ kind: "source-primitive", name: sourcePrimitive }),
    });
  }
  if (name === "String") {
    return Object.freeze({ source: Object.freeze({ kind: "string" }), target: Object.freeze({ kind: "native-string" }) });
  }
  if (name === "None" || name === "NoneType") return unitProjection;
  if (name === "Never") {
    return Object.freeze({ source: Object.freeze({ kind: "never" }), target: Object.freeze({ kind: "unit" }) });
  }
  return undefined;
}

function namedTargetType(
  package_: MojoCompilerPackageSnapshot,
  modulePath: readonly string[],
  name: string,
  genericArguments: readonly MojoTargetGenericArgument[],
): MojoTargetTypeRef {
  return Object.freeze({
    kind: "target-named",
    id: `${compilerModuleIdentity(package_, modulePath)}::type:${name}`,
    modulePath: Object.freeze([package_.packageName, ...modulePath]),
    name,
    ...(genericArguments.length === 0 ? {} : { genericArguments: Object.freeze(genericArguments) }),
  });
}

function addImport(imports: Map<string, Set<string>>, moduleSpecifier: string, exportName: string): void {
  const names = imports.get(moduleSpecifier) ?? new Set<string>();
  names.add(exportName);
  imports.set(moduleSpecifier, names);
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

const primitiveNames = new Map<string, import("@tsonic/tsts").SourcePrimitiveKind>([
  ["Bool", "bool"],
  ["Int8", "int8"],
  ["UInt8", "uint8"],
  ["Int16", "int16"],
  ["UInt16", "uint16"],
  ["Int32", "int32"],
  ["UInt32", "uint32"],
  ["Int64", "int64"],
  ["UInt64", "uint64"],
  ["Int", "native-int"],
  ["UInt", "native-uint"],
  ["Float16", "float16"],
  ["Float32", "float32"],
  ["Float64", "float64"],
]);

const unitProjection: MojoCompilerTypeProjection = Object.freeze({
  source: Object.freeze({ kind: "void" }),
  target: Object.freeze({ kind: "unit" }),
});
