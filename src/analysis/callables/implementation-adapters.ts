import type { Node } from "@tsonic/tsts";
import { classifyMojoValueConversion } from "../../policy/conversions/selection.js";
import { mojoGenericParameterReference } from "../../target-model/types/constructors.js";
import { substituteMojoTargetType } from "../../target-model/types/substitution.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type { MojoSourceCallableSpecializationPlan } from "./specializations.js";
import { selectMojoCallableParameterAdapters } from "./parameter-adapters.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedCallableSignature,
  MojoAnalyzedFunction,
  MojoAnalyzedParameter,
  MojoAnalyzedTypeParameter,
  MojoCallableImplementationAdapter,
} from "../program/model.js";

export interface MojoCallableImplementationAdapterIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

export function analyzeMojoCallableImplementationAdapters(input: {
  readonly topLevelContracts: readonly MojoAnalyzedCallableSignature[];
  readonly classes: readonly MojoAnalyzedClass[];
  readonly implementations: WeakMap<Node, MojoAnalyzedFunction>;
  readonly callableImplementation: (
    declaration: Node,
  ) => ReturnType<import("@tsonic/target-api/analysis").TargetPlanningSourceNavigation["callableImplementation"]>;
  readonly relationships: MojoProjectTypeRelationships;
  readonly specializations: MojoSourceCallableSpecializationPlan;
}): {
  readonly adapters: readonly MojoCallableImplementationAdapter[];
  readonly issues: readonly MojoCallableImplementationAdapterIssue[];
} {
  const adapters: MojoCallableImplementationAdapter[] = [];
  const issues: MojoCallableImplementationAdapterIssue[] = [];
  const candidates: {
    readonly contract: MojoAnalyzedCallableSignature;
    readonly owner?: MojoAnalyzedClass;
    readonly required: boolean;
  }[] = [
    ...input.topLevelContracts.map((contract) => Object.freeze({
      contract,
      required: true,
    })),
    ...input.classes.flatMap((owner) => owner.callableContracts.map((contract) => Object.freeze({
      contract,
      owner,
      required: contract.kind === "constructor",
    }))),
  ];
  for (const candidate of candidates) {
    const { contract } = candidate;
    if (input.implementations.has(contract.declaration)) continue;
    const selected = input.callableImplementation(contract.declaration);
    const implementation = selected.kind === "resolved"
      ? input.implementations.get(selected.implementation.declaration)
      : undefined;
    if (implementation === undefined) {
      if (candidate.required) {
        issues.push(issue(
          contract.declaration,
          contract.kind === "constructor"
            ? "MOJO_PROJECT_CONSTRUCTOR_IMPLEMENTATION_MISSING"
            : "MOJO_PROJECT_FUNCTION_IMPLEMENTATION_MISSING",
          contract.kind === "constructor"
            ? "A constructor overload contract has no exact analyzed implementation body."
            : "A top-level function overload contract has no exact analyzed implementation body.",
        ));
      }
      continue;
    }
    if (implementation.kind !== contract.kind ||
      (contract.kind !== "function" && contract.kind !== "method" &&
        contract.kind !== "constructor") ||
      implementation.sourceFile !== contract.sourceFile) {
      issues.push(issue(
        contract.declaration,
        "MOJO_CALLABLE_OVERLOAD_IMPLEMENTATION_IDENTITY_INVALID",
        "A callable overload contract must resolve to one same-kind implementation body in the same exact source module.",
      ));
      continue;
    }
    const kind = adapterKind(contract);
    const name = kind === "constructor-overload"
      ? "__init__"
      : contract.implementationAdapterName;
    if (kind === undefined || name === undefined ||
      kind !== "top-level-function-overload" && candidate.owner === undefined) {
      issues.push(issue(
        contract.declaration,
        "MOJO_CALLABLE_OVERLOAD_ADAPTER_IDENTITY_UNRESOLVED",
        "A callable overload contract has no exact target-owned adapter identity.",
      ));
      continue;
    }
    if (input.specializations.requiresSpecialization(implementation.declaration)) {
      issues.push(issue(
        contract.declaration,
        "MOJO_FUNCTION_OVERLOAD_SPECIALIZATION_UNCLOSED",
        "A top-level overload adapter cannot target an implementation that requires a finite closed specialization.",
      ));
      continue;
    }
    const genericClosure = closeImplementationGenerics(contract, implementation);
    if (genericClosure === undefined) {
      issues.push(issue(
        contract.declaration,
        "MOJO_FUNCTION_OVERLOAD_GENERIC_ABI_UNCLOSED",
        "A top-level overload contract and implementation do not have one exact generic-parameter adaptation.",
      ));
      continue;
    }
    const targetParameters = Object.freeze(implementation.parameters.map((parameter) =>
      substituteParameter(parameter, genericClosure.substitutions)));
    const parameterAdapters = selectMojoCallableParameterAdapters(
      contract.parameters,
      targetParameters,
      input.relationships,
    );
    const implementationResultType = substituteMojoTargetType(
      implementation.resultType,
      genericClosure.substitutions,
    );
    const resultConversion = classifyOverloadResultConversion(
      implementationResultType,
      contract.resultType,
      input.relationships,
    );
    if (parameterAdapters === undefined || resultConversion.kind === "unsupported" ||
      contract.asynchronous !== implementation.asynchronous) {
      issues.push(issue(
        contract.declaration,
        "MOJO_FUNCTION_OVERLOAD_IMPLEMENTATION_ABI_UNCLOSED",
        parameterAdapters === undefined
          ? "A callable overload contract cannot adapt its parameters to the exact implementation ABI."
          : resultConversion.kind === "unsupported"
            ? `A callable overload implementation result cannot satisfy its exact contract: ${resultConversion.reason}.`
            : "A callable overload contract and implementation disagree on synchronous versus asynchronous execution.",
      ));
      continue;
    }
    adapters.push(Object.freeze({
      kind,
      contract,
      implementation,
      ...(candidate.owner === undefined ? {} : { owner: candidate.owner }),
      sourceFile: implementation.sourceFile,
      name,
      targetGenericArguments: genericClosure.arguments,
      targetParameters,
      parameterAdapters,
      implementationResultType,
      resultConversion: resultConversion.conversion,
      raises: implementation.raises,
      ...(implementation.errorType === undefined ? {} : { errorType: implementation.errorType }),
    }));
  }
  return Object.freeze({
    adapters: Object.freeze(adapters),
    issues: Object.freeze(issues),
  });
}

function classifyOverloadResultConversion(
  implementationType: MojoTargetTypeRef,
  contractType: MojoTargetTypeRef,
  relationships: MojoProjectTypeRelationships,
): ReturnType<typeof classifyMojoValueConversion> {
  const direct = classifyMojoValueConversion(
    implementationType,
    contractType,
    undefined,
    relationships,
  );
  if (direct.kind === "resolved" || implementationType.kind !== "union") return direct;
  const members = implementationType.members.flatMap((sourceType) => {
    const selected = classifyMojoValueConversion(
      sourceType,
      contractType,
      undefined,
      relationships,
    );
    return selected.kind === "resolved"
      ? [Object.freeze({ sourceType, conversion: selected.conversion })]
      : [];
  });
  if (members.length === 0) return direct;
  return Object.freeze({
    kind: "resolved" as const,
    conversion: Object.freeze({
      kind: "narrowed-union-map" as const,
      sourceType: implementationType,
      selectedType: Object.freeze({
        kind: "union" as const,
        members: Object.freeze(members.map((member) => member.sourceType)),
      }),
      targetType: contractType,
      members: Object.freeze(members),
    }),
  });
}

function adapterKind(
  contract: MojoAnalyzedCallableSignature,
): MojoCallableImplementationAdapter["kind"] | undefined {
  if (contract.kind === "function") return "top-level-function-overload";
  if (contract.kind === "constructor") return "constructor-overload";
  if (contract.kind !== "method") return undefined;
  return contract.static === true
    ? "static-method-overload"
    : "instance-method-overload";
}

function closeImplementationGenerics(
  contract: MojoAnalyzedCallableSignature,
  implementation: MojoAnalyzedFunction,
): {
  readonly arguments: readonly MojoTargetGenericArgument[];
  readonly substitutions: import("../../target-model/types/substitution.js").MojoTargetTypeSubstitutions;
} | undefined {
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  if (implementation.typeParameters.length === 0) {
    return Object.freeze({
      arguments: Object.freeze([]),
      substitutions: Object.freeze({ types, values, origins, packs: new Map() }),
    });
  }
  if (implementation.typeParameters.length !== contract.typeParameters.length) return undefined;
  const arguments_: MojoTargetGenericArgument[] = [];
  for (const [index, target] of implementation.typeParameters.entries()) {
    const source = contract.typeParameters[index];
    if (source === undefined || source.kind !== target.kind || source.variadic || target.variadic) {
      return undefined;
    }
    const argument = namedGenericArgument(mojoGenericParameterReference(source), target);
    arguments_.push(argument);
    if (!recordSubstitution(target, argument, types, values, origins)) return undefined;
  }
  return Object.freeze({
    arguments: Object.freeze(arguments_),
    substitutions: Object.freeze({ types, values, origins, packs: new Map() }),
  });
}

function namedGenericArgument(
  argument: MojoTargetGenericArgument,
  parameter: MojoAnalyzedTypeParameter,
): MojoTargetGenericArgument {
  return parameter.position !== "keyword"
    ? argument
    : Object.freeze({ ...argument, name: parameter.name });
}

function recordSubstitution(
  parameter: MojoAnalyzedTypeParameter,
  argument: MojoTargetGenericArgument,
  types: Map<string, MojoTargetTypeRef>,
  values: Map<string, MojoTargetGenericArgument>,
  origins: Map<string, import("../../target-model/origins/model.js").MojoOriginRef>,
): boolean {
  if (parameter.kind === "type" && argument.kind === "type") {
    types.set(parameter.identity, argument.type);
    types.set(parameter.name, argument.type);
    return true;
  }
  if (parameter.kind === "origin" && argument.kind === "origin") {
    origins.set(parameter.name, argument.origin);
    return true;
  }
  if (parameter.kind === "value" && argument.kind !== "type" && argument.kind !== "origin") {
    values.set(parameter.name, argument);
    return true;
  }
  return false;
}

function substituteParameter(
  parameter: MojoAnalyzedParameter,
  substitutions: import("../../target-model/types/substitution.js").MojoTargetTypeSubstitutions,
): MojoAnalyzedParameter {
  return Object.freeze({
    ...parameter,
    type: substituteMojoTargetType(parameter.type, substitutions),
    bodyType: substituteMojoTargetType(parameter.bodyType, substitutions),
    callType: substituteMojoTargetType(parameter.callType, substitutions),
  });
}

function issue(
  node: Node,
  code: string,
  message: string,
): MojoCallableImplementationAdapterIssue {
  return Object.freeze({ node, code, message });
}
