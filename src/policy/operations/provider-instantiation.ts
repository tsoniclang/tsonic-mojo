import type { ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoProviderOperationRow } from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type {
  MojoProviderTargetGenericParameter,
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type {
  MojoProviderOperationForm,
} from "../../target-model/operations/model.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type { MojoSelectedProviderOperation } from "../../target-model/operations/selection.js";

export type MojoProviderOperationInstantiation =
  | { readonly kind: "resolved"; readonly operation: MojoSelectedProviderOperation }
  | { readonly kind: "unsupported"; readonly reason: string };

export function instantiateMojoProviderOperation(
  row: MojoProviderOperationRow,
  source: ResolvedSourceCallInfo,
  resolveType: (type: Type, authoredTypeNode?: import("@tsonic/tsts").Node) => MojoTargetTypeRef | undefined,
  resolveNonTypeGenericArguments: (
    parameter: MojoProviderTargetGenericParameter,
    explicitTypeNode: import("@tsonic/tsts").Node,
  ) => readonly MojoTargetGenericArgument[] | undefined,
): MojoProviderOperationInstantiation {
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const valueSubstitutions = new Map<string, MojoTargetGenericArgument>();
  const originSubstitutions = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  const packSubstitutions = new Map<string, readonly MojoTargetGenericArgument[]>();
  if (row.receiverType !== undefined) {
    const sourceReceiver = source.sourceReceiver?.type;
    const receiver = sourceReceiver === undefined ? undefined : resolveType(sourceReceiver);
    if (receiver === undefined) {
      return { kind: "unsupported", reason: "the selected provider receiver has no closed Mojo carrier" };
    }
    const mismatch = bindTargetTypePattern(row.receiverType, receiver, typeSubstitutions);
    if (mismatch !== undefined) {
      return { kind: "unsupported", reason: `the selected provider receiver does not close its Mojo ABI: ${mismatch}` };
    }
  }

  const targetGenericParameters = row.target.kind === "function-call" || row.target.kind === "instance-call"
    ? row.target.genericParameters ?? []
    : [];
  const selectedArguments = source.sourceSelectedMethodTypeArguments ?? [];
  const genericArguments: MojoTargetGenericArgument[] = [];
  for (const parameter of targetGenericParameters) {
    const selected = selectedArguments.filter((argument) => argument.typeParameterName === parameter.name);
    if (selected.length === 0 && (parameter.position === "inferred" || parameter.defaultArgument !== undefined)) {
      continue;
    }
    if (selected.length !== 1) {
      return {
        kind: "unsupported",
        reason: `selected provider ${parameter.kind} parameter '${parameter.name}' has ${selected.length} exact source arguments`,
      };
    }
    const evidence = selected[0]!;
    if (parameter.kind !== "type") {
      if (evidence.explicitTypeNode === undefined) {
        if (parameter.position === "inferred") continue;
        return {
          kind: "unsupported",
          reason: `selected provider ${parameter.kind} parameter '${parameter.name}' has no exact authored argument`,
        };
      }
      const resolved = resolveNonTypeGenericArguments(parameter, evidence.explicitTypeNode);
      if (resolved === undefined || resolved.length === 0 || (!parameter.variadic && resolved.length !== 1)) {
        return {
          kind: "unsupported",
          reason: `selected provider ${parameter.kind} parameter '${parameter.name}' has no closed Mojo argument`,
        };
      }
      for (const argument of resolved) {
        const named = parameter.position === "keyword"
          ? Object.freeze({ ...argument, name: parameter.name })
          : argument;
        genericArguments.push(named);
      }
      if (parameter.variadic) packSubstitutions.set(parameter.name, resolved);
      if (resolved.length === 1) {
        const [argument] = resolved;
        if (parameter.kind === "origin" && argument?.kind === "origin") {
          originSubstitutions.set(parameter.name, argument.origin);
        } else if (parameter.kind === "value" && argument !== undefined) {
          valueSubstitutions.set(parameter.name, argument);
        }
      }
      continue;
    }
    const targetType = resolveType(evidence.selectedType, evidence.explicitTypeNode);
    if (targetType === undefined) {
      return {
        kind: "unsupported",
        reason: `selected provider type argument '${parameter.name}' has no closed Mojo carrier`,
      };
    }
    const existing = typeSubstitutions.get(parameter.name);
    if (existing !== undefined && !mojoTargetTypeEquals(existing, targetType)) {
      return {
        kind: "unsupported",
        reason: `selected provider type argument '${parameter.name}' contradicts receiver inference`,
      };
    }
    if (parameter.variadic) {
      if (targetType.kind !== "tuple") {
        return {
          kind: "unsupported",
          reason: `selected variadic provider type argument '${parameter.name}' is not an exact tuple pack`,
        };
      }
      const pack = Object.freeze(targetType.elements.map((element) =>
        Object.freeze({ kind: "type" as const, type: element })));
      packSubstitutions.set(parameter.name, pack);
      if (parameter.position !== "inferred") genericArguments.push(...pack);
    } else {
      typeSubstitutions.set(parameter.name, targetType);
      if (parameter.position !== "inferred") {
        genericArguments.push(Object.freeze({
          kind: "type",
          ...(parameter.position === "keyword" ? { name: parameter.name } : {}),
          type: targetType,
        }));
      }
    }
  }

  const substitutions = {
    types: typeSubstitutions,
    values: valueSubstitutions,
    origins: originSubstitutions,
    packs: packSubstitutions,
  };
  return {
    kind: "resolved",
    operation: Object.freeze({
      target: substituteOperationForm(row.target, substitutions),
      ...(row.receiverType === undefined
        ? {}
        : { receiverType: substituteMojoTargetType(row.receiverType, substitutions) }),
      parameterTypes: Object.freeze((row.parameterTypes ?? []).map((type) =>
        substituteMojoTargetType(type, substitutions))),
      resultType: substituteMojoTargetType(row.resultType, substitutions),
      genericArguments: Object.freeze(genericArguments),
      genericParameters: Object.freeze(targetGenericParameters),
      raises: row.raises === true,
      ...(row.errorType === undefined
        ? {}
        : { errorType: substituteMojoTargetType(row.errorType, substitutions) }),
    }),
  };
}

export function instantiateMojoProviderPropertyOperation(
  row: MojoProviderOperationRow,
  receiver: MojoTargetTypeRef,
): MojoProviderOperationInstantiation {
  if (row.receiverType === undefined) {
    return { kind: "unsupported", reason: "selected provider property has no receiver carrier pattern" };
  }
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const mismatch = bindTargetTypePattern(row.receiverType, receiver, typeSubstitutions);
  if (mismatch !== undefined) {
    return { kind: "unsupported", reason: `the selected provider property receiver does not close its Mojo ABI: ${mismatch}` };
  }
  const substitutions = {
    types: typeSubstitutions,
    values: new Map<string, never>(),
    origins: new Map<string, never>(),
    packs: new Map<string, never>(),
  };
  return {
    kind: "resolved",
    operation: Object.freeze({
      target: substituteOperationForm(row.target, substitutions),
      receiverType: substituteMojoTargetType(row.receiverType, substitutions),
      parameterTypes: Object.freeze((row.parameterTypes ?? []).map((type) =>
        substituteMojoTargetType(type, substitutions))),
      resultType: substituteMojoTargetType(row.resultType, substitutions),
      genericArguments: Object.freeze([]),
      genericParameters: Object.freeze([]),
      raises: row.raises === true,
      ...(row.errorType === undefined
        ? {}
        : { errorType: substituteMojoTargetType(row.errorType, substitutions) }),
    }),
  };
}

export function instantiateMojoProviderConstantOperation(
  row: MojoProviderOperationRow,
): MojoProviderOperationInstantiation {
  if (row.receiverType !== undefined || (row.parameterTypes ?? []).length !== 0 ||
    (row.target.kind !== "constant" && row.target.kind !== "function-read")) {
    return { kind: "unsupported", reason: "selected provider value has a receiver, parameters, or non-value target" };
  }
  return {
    kind: "resolved",
    operation: Object.freeze({
      target: row.target,
      parameterTypes: Object.freeze([]),
      resultType: row.resultType,
      genericArguments: Object.freeze([]),
      genericParameters: Object.freeze([]),
      raises: row.raises === true,
      ...(row.errorType === undefined ? {} : { errorType: row.errorType }),
    }),
  };
}

function substituteOperationForm(
  target: MojoProviderOperationForm,
  substitutions: Parameters<typeof substituteMojoTargetType>[1],
): MojoProviderOperationForm {
  if (target.kind !== "function-call" && target.kind !== "instance-call") return target;
  return Object.freeze({
    ...target,
    ...(target.genericParameters === undefined
      ? {}
      : {
          genericParameters: Object.freeze(target.genericParameters.map((parameter) => Object.freeze({
            ...parameter,
            constraints: Object.freeze(parameter.constraints.map((constraint) =>
              substituteMojoTargetType(constraint, substitutions))),
            ...(parameter.defaultArgument?.kind === "type"
              ? {
                  defaultArgument: Object.freeze({
                    ...parameter.defaultArgument,
                    type: substituteMojoTargetType(parameter.defaultArgument.type, substitutions),
                  }),
                }
              : {}),
          }))),
        }),
  });
}

export function bindTargetTypePattern(
  pattern: MojoTargetTypeRef,
  actual: MojoTargetTypeRef,
  bindings: Map<string, MojoTargetTypeRef>,
): string | undefined {
  if (pattern.kind === "type-parameter") {
    const existing = bindings.get(pattern.name);
    if (existing === undefined) {
      bindings.set(pattern.name, actual);
      return undefined;
    }
    return mojoTargetTypeEquals(existing, actual)
      ? undefined
      : `type parameter '${pattern.name}' received contradictory carriers`;
  }
  if (pattern.kind !== actual.kind) return `'${pattern.kind}' does not match '${actual.kind}'`;
  switch (pattern.kind) {
    case "source-primitive":
    case "native-string":
    case "unit":
    case "never":
    case "null":
    case "undefined":
    case "dynamic":
    case "bigint":
    case "symbol":
    case "compiler-expression":
      return mojoTargetTypeEquals(pattern, actual) ? undefined : "closed receiver carriers differ";
    case "target-named": {
      if (actual.kind !== "target-named" || pattern.id !== actual.id) return "target type identities differ";
      const expected = pattern.genericArguments ?? [];
      const observed = actual.genericArguments ?? [];
      if (expected.length !== observed.length) return "target generic arities differ";
      for (let index = 0; index < expected.length; index += 1) {
        const left = expected[index]!;
        const right = observed[index]!;
        if (left.kind !== "type" || right.kind !== "type") {
          if (JSON.stringify(left) !== JSON.stringify(right)) return "non-type generic arguments differ";
          continue;
        }
        const mismatch = bindTargetTypePattern(left.type, right.type, bindings);
        if (mismatch !== undefined) return mismatch;
      }
      return undefined;
    }
    case "list":
      return actual.kind === "list" ? bindTargetTypePattern(pattern.element, actual.element, bindings) : "list carriers differ";
    case "fixed-array":
      return actual.kind === "fixed-array" && JSON.stringify(pattern.length) === JSON.stringify(actual.length)
        ? bindTargetTypePattern(pattern.element, actual.element, bindings)
        : "fixed-array carriers differ";
    case "dictionary": {
      if (actual.kind !== "dictionary") return "dictionary carriers differ";
      return bindTargetTypePattern(pattern.key, actual.key, bindings) ??
        bindTargetTypePattern(pattern.value, actual.value, bindings);
    }
    case "future":
      return actual.kind === "future"
        ? bindTargetTypePattern(pattern.output, actual.output, bindings)
        : "future carriers differ";
    case "optional":
      return actual.kind === "optional" ? bindTargetTypePattern(pattern.value, actual.value, bindings) : "optional carriers differ";
    case "union":
    case "tuple": {
      const left = pattern.kind === "union" ? pattern.members : pattern.elements;
      const right = actual.kind === "union" ? actual.members : actual.kind === "tuple" ? actual.elements : [];
      if (left.length !== right.length) return `${pattern.kind} carrier arities differ`;
      for (let index = 0; index < left.length; index += 1) {
        const mismatch = bindTargetTypePattern(left[index]!, right[index]!, bindings);
        if (mismatch !== undefined) return mismatch;
      }
      return undefined;
    }
    case "associated":
    case "reference":
    case "callable":
    case "function":
      return mojoTargetTypeEquals(pattern, actual) ? undefined : "advanced receiver carriers differ";
  }
}
