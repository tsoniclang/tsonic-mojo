import type { ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoProviderOperationRow } from "../../providers/packages/model.js";
import { mojoTargetGenericArgumentsEqual, mojoTargetTypeEquals } from "../../target-model/types/equality.js";
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
import { bindTargetTypePattern } from "./provider-bindings.js";
import { mojoOriginEquals } from "../../target-model/origins/identity.js";

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
  selectedReceiver?: MojoTargetTypeRef,
): MojoProviderOperationInstantiation {
  const typeSubstitutions = new Map<string, MojoTargetTypeRef>();
  const valueSubstitutions = new Map<string, MojoTargetGenericArgument>();
  const originSubstitutions = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  const packSubstitutions = new Map<string, readonly MojoTargetGenericArgument[]>();
  if (row.receiverType !== undefined) {
    const sourceReceiver = source.sourceReceiver?.type;
    const receiver = selectedReceiver ?? (sourceReceiver === undefined ? undefined : resolveType(sourceReceiver));
    if (receiver === undefined) {
      return { kind: "unsupported", reason: "the selected provider receiver has no closed Mojo carrier" };
    }
    const mismatch = bindTargetTypePattern(row.receiverType, receiver, {
      types: typeSubstitutions, values: valueSubstitutions, origins: originSubstitutions, packs: packSubstitutions,
    });
    if (mismatch !== undefined) {
      return { kind: "unsupported", reason: `the selected provider receiver does not close its Mojo ABI: ${mismatch}` };
    }
  }

  const targetGenericParameters = row.target.kind === "function-call" || row.target.kind === "instance-call" || row.target.kind === "value-predicate"
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
          const existing = originSubstitutions.get(parameter.name);
          if (existing !== undefined && !mojoOriginEquals(existing, argument.origin)) {
            return { kind: "unsupported", reason: `selected provider origin argument '${parameter.name}' contradicts its receiver` };
          }
          originSubstitutions.set(parameter.name, argument.origin);
        } else if (parameter.kind === "value" && argument !== undefined) {
          const existing = valueSubstitutions.get(parameter.name);
          if (existing !== undefined && !mojoTargetGenericArgumentsEqual([existing], [argument])) {
            return { kind: "unsupported", reason: `selected provider value argument '${parameter.name}' contradicts its receiver` };
          }
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
  const substitutions = {
    types: typeSubstitutions,
    values: new Map<string, MojoTargetGenericArgument>(),
    origins: new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>(),
    packs: new Map<string, readonly MojoTargetGenericArgument[]>(),
  };
  const mismatch = bindTargetTypePattern(row.receiverType, receiver, substitutions);
  if (mismatch !== undefined) {
    return { kind: "unsupported", reason: `the selected provider property receiver does not close its Mojo ABI: ${mismatch}` };
  }
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
  if (target.kind === "value-predicate") {
    return Object.freeze({
      ...target,
      predicate: Object.freeze({ ...target.predicate, acceptedType: substituteMojoTargetType(target.predicate.acceptedType, substitutions) }),
    });
  }
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
