import type { ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoProviderOperationRow } from "../../providers/packages/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type {
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
  resolveType: (type: Type) => MojoTargetTypeRef | undefined,
): MojoProviderOperationInstantiation {
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
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
    if (parameter.kind !== "type") {
      return {
        kind: "unsupported",
        reason: `selected provider ${parameter.kind} parameter '${parameter.name}' requires exact non-type generic evidence`,
      };
    }
    if (selected.length !== 1) {
      if (parameter.position === "inferred") continue;
      return {
        kind: "unsupported",
        reason: `selected provider type parameter '${parameter.name}' has ${selected.length} exact source arguments`,
      };
    }
    const targetType = resolveType(selected[0]!.selectedType);
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
    typeSubstitutions.set(parameter.name, targetType);
    if (parameter.position !== "inferred") {
      genericArguments.push(Object.freeze({
        kind: "type",
        ...(parameter.position === "keyword" ? { name: parameter.name } : {}),
        type: targetType,
      }));
    }
  }

  const substitutions = {
    types: typeSubstitutions,
    constants: new Map(),
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
  const substitutions = { types: typeSubstitutions, constants: new Map<string, never>() };
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
    }),
  };
}

export function instantiateMojoProviderConstantOperation(
  row: MojoProviderOperationRow,
): MojoProviderOperationInstantiation {
  if (row.receiverType !== undefined || (row.parameterTypes ?? []).length !== 0 ||
    row.target.kind !== "constant") {
    return { kind: "unsupported", reason: "selected provider constant has a receiver, parameters, or non-constant target" };
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
    case "function":
      return mojoTargetTypeEquals(pattern, actual) ? undefined : "advanced receiver carriers differ";
  }
}
