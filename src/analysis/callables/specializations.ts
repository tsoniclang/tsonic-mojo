import type { AstReader, Node } from "@tsonic/tsts";
import { createMojoNameAllocator } from "../names/allocator.js";
import type {
  MojoAnalyzedClass,
  MojoAnalyzedFunction,
  MojoAnalyzedInterface,
  MojoAnalyzedTypeParameter,
  MojoCallSelection,
  MojoCallableExpressionSelection,
} from "../program/model.js";
import type { MojoProjectTypeRelationships } from "../../target-model/types/project.js";
import type {
  MojoTargetGenericArgument,
  MojoTargetTypeRef,
} from "../../target-model/types/model.js";
import { mojoTargetGenericArgumentsEqual } from "../../target-model/types/equality.js";
import {
  substituteMojoTargetGenericArguments,
  type MojoTargetTypeSubstitutions,
} from "../../target-model/types/substitution.js";

const maximumSpecializationEntries = 1_048_576;

export interface MojoSourceCallableSpecializationVariant {
  readonly declaration: Node;
  readonly sourceParameters: readonly MojoAnalyzedTypeParameter[];
  readonly targetArguments: readonly MojoTargetGenericArgument[];
  readonly targetName: string;
  readonly substitutions: MojoTargetTypeSubstitutions;
}

export interface MojoProjectMethodSpecializationRequest {
  readonly declaration: Node;
  readonly implementationDeclaration: Node;
  readonly targetArguments: readonly MojoTargetGenericArgument[];
}

export interface MojoSourceCallableSpecializationIssue {
  readonly node: Node;
  readonly code: string;
  readonly message: string;
}

export interface MojoSourceCallableSpecializationPlan {
  readonly issues: readonly MojoSourceCallableSpecializationIssue[];
  readonly projectMethodRequests: readonly MojoProjectMethodSpecializationRequest[];
  readonly representationTypes: readonly MojoTargetTypeRef[];
  readonly allocatedNames: readonly string[];
  requiresSpecialization(declaration: Node): boolean;
  variantsForCallable(declaration: Node): readonly MojoSourceCallableSpecializationVariant[];
  variantForCall(
    declaration: Node,
    targetArguments: readonly MojoTargetGenericArgument[],
  ): MojoSourceCallableSpecializationVariant | undefined;
}

interface CallableDescriptor {
  readonly declaration: Node;
  readonly function?: MojoAnalyzedFunction;
  readonly typeParameters: readonly MojoAnalyzedTypeParameter[];
  readonly name: string;
  readonly supported: boolean;
}

interface SourceCallEdge {
  readonly node: Node;
  readonly caller?: CallableDescriptor;
  readonly callee: Node;
  readonly targetArguments: readonly MojoTargetGenericArgument[];
}

interface ProjectMethodEdge {
  readonly node: Node;
  readonly caller?: CallableDescriptor;
  readonly declaration: Node;
  readonly implementationDeclaration: Node;
  readonly targetArguments: readonly MojoTargetGenericArgument[];
}

interface MutableVariant {
  readonly declaration: Node;
  readonly sourceParameters: readonly MojoAnalyzedTypeParameter[];
  readonly targetArguments: readonly MojoTargetGenericArgument[];
  readonly substitutions: MojoTargetTypeSubstitutions;
  targetName?: string;
}

export function createMojoSourceCallableSpecializationPlan(input: {
  readonly ast: AstReader;
  readonly functions: readonly MojoAnalyzedFunction[];
  readonly classes: readonly MojoAnalyzedClass[];
  readonly interfaces: readonly MojoAnalyzedInterface[];
  readonly callNodes: ReadonlySet<Node>;
  readonly callSelections: WeakMap<Node, MojoCallSelection>;
  readonly callableExpressionNodes: ReadonlySet<Node>;
  readonly callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>;
  readonly relationships: MojoProjectTypeRelationships;
  readonly reservedNames: ReadonlySet<string>;
  readonly libraryOutput: boolean;
}): MojoSourceCallableSpecializationPlan {
  const descriptors = createCallableDescriptors(
    input.functions,
    input.callableExpressionNodes,
    input.callableExpressionSelections,
  );
  const polymorphicDefinitions = new Set([
    ...input.classes.filter((value) => value.polymorphic).map((value) => value.definition),
    ...input.interfaces.filter((value) => value.polymorphic).map((value) => value.definition),
  ]);
  const sourceCalls: SourceCallEdge[] = [];
  const projectMethodCalls: ProjectMethodEdge[] = [];
  for (const node of input.callNodes) {
    const selection = input.callSelections.get(node);
    if (selection?.kind !== "project") continue;
    const caller = enclosingCallable(node, input.ast, descriptors);
    if (selection.target.kind === "function") {
      sourceCalls.push(Object.freeze({
        node,
        ...(caller === undefined ? {} : { caller }),
        callee: selection.target.declaration,
        targetArguments: selection.genericArguments,
      }));
      continue;
    }
    if (selection.target.kind === "static-method") {
      sourceCalls.push(Object.freeze({
        node,
        ...(caller === undefined ? {} : { caller }),
        callee: selection.target.implementationDeclaration,
        targetArguments: selection.genericArguments,
      }));
      continue;
    }
    if (selection.target.kind !== "method") continue;
    const owner = input.relationships.definitionContainingDeclaration(selection.target.declaration);
    if (owner === undefined || !polymorphicDefinitions.has(owner)) {
      sourceCalls.push(Object.freeze({
        node,
        ...(caller === undefined ? {} : { caller }),
        callee: selection.target.implementationDeclaration,
        targetArguments: selection.genericArguments,
      }));
      continue;
    }
    projectMethodCalls.push(Object.freeze({
      node,
      ...(caller === undefined ? {} : { caller }),
      declaration: selection.target.declaration,
      implementationDeclaration: selection.target.implementationDeclaration,
      targetArguments: selection.genericArguments,
    }));
  }

  const required = requiredCallableSpecializations(sourceCalls, projectMethodCalls);
  const issues: MojoSourceCallableSpecializationIssue[] = [];
  const issueKeys = new Set<string>();
  const variants = new Map<Node, MutableVariant[]>();
  const methodRequests: MojoProjectMethodSpecializationRequest[] = [];
  const addIssue = (node: Node, code: string, message: string): void => {
    const sourceFile = input.ast.getSourceFile(node);
    const key = `${input.ast.getFileName(sourceFile)}:${input.ast.pos(node)}:${input.ast.end(node)}:${code}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);
    issues.push(Object.freeze({ node, code, message }));
  };
  const addVariant = (
    declaration: Node,
    targetArguments: readonly MojoTargetGenericArgument[],
    subject: Node,
  ): boolean => {
    const descriptor = descriptors.get(declaration);
    if (descriptor === undefined || descriptor.typeParameters.length !== targetArguments.length) {
      addIssue(
        subject,
        "MOJO_SOURCE_CALLABLE_SPECIALIZATION_ARITY_CONFLICT",
        "A required finite Mojo callable specialization conflicts with its exact declaration arity.",
      );
      return false;
    }
    const owner = input.relationships.definitionContainingDeclaration(declaration);
    const allowed = parameterKeys(owner?.typeParameters ?? []);
    const referenced = genericArgumentParameterKeys(targetArguments);
    if ([...referenced].some((key) => !allowed.has(key))) return false;
    const existing = variants.get(declaration) ?? [];
    if (existing.some((variant) =>
      mojoTargetGenericArgumentsEqual(variant.targetArguments, targetArguments))) return false;
    const substitutions = substitutionsFor(descriptor.typeParameters, targetArguments);
    if (substitutions === undefined) {
      addIssue(
        subject,
        "MOJO_SOURCE_CALLABLE_SPECIALIZATION_KIND_CONFLICT",
        "A required finite Mojo callable specialization conflicts with its exact generic-parameter kinds.",
      );
      return false;
    }
    existing.push({
      declaration,
      sourceParameters: descriptor.typeParameters,
      targetArguments: Object.freeze([...targetArguments]),
      substitutions,
    });
    variants.set(declaration, existing);
    return true;
  };
  const addMethodRequest = (
    edge: Pick<ProjectMethodEdge, "declaration" | "implementationDeclaration" | "targetArguments" | "node">,
    targetArguments: readonly MojoTargetGenericArgument[],
  ): boolean => {
    const owner = input.relationships.definitionContainingDeclaration(edge.declaration);
    const referenced = genericArgumentParameterKeys(targetArguments);
    const allowed = parameterKeys(owner?.typeParameters ?? []);
    if (owner === undefined || [...referenced].some((key) => !allowed.has(key))) return false;
    if (methodRequests.some((request) => request.declaration === edge.declaration &&
      mojoTargetGenericArgumentsEqual(request.targetArguments, targetArguments))) return false;
    methodRequests.push(Object.freeze({
      declaration: edge.declaration,
      implementationDeclaration: edge.implementationDeclaration,
      targetArguments: Object.freeze([...targetArguments]),
    }));
    if (required.has(edge.implementationDeclaration)) {
      addVariant(edge.implementationDeclaration, targetArguments, edge.node);
    }
    return true;
  };

  for (const edge of sourceCalls) {
    if (!required.has(edge.callee) ||
      edge.caller !== undefined && argumentsUseParameters(edge.targetArguments, edge.caller.typeParameters)) {
      continue;
    }
    addVariant(edge.callee, edge.targetArguments, edge.node);
  }
  for (const edge of projectMethodCalls) {
    if (edge.caller !== undefined && argumentsUseParameters(edge.targetArguments, edge.caller.typeParameters)) {
      continue;
    }
    addMethodRequest(edge, edge.targetArguments);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of sourceCalls) {
      if (!required.has(edge.callee) || edge.caller === undefined) continue;
      for (const callerVariant of variants.get(edge.caller.declaration) ?? []) {
        const arguments_ = substituteMojoTargetGenericArguments(
          edge.targetArguments,
          callerVariant.substitutions,
        );
        changed = addVariant(edge.callee, arguments_, edge.node) || changed;
      }
    }
    for (const edge of projectMethodCalls) {
      if (edge.caller === undefined) continue;
      for (const callerVariant of variants.get(edge.caller.declaration) ?? []) {
        const arguments_ = substituteMojoTargetGenericArguments(
          edge.targetArguments,
          callerVariant.substitutions,
        );
        changed = addMethodRequest(edge, arguments_) || changed;
      }
    }
    if (variantCount(variants) + methodRequests.length > maximumSpecializationEntries) {
      const node = sourceCalls[0]?.node ?? projectMethodCalls[0]?.node;
      if (node !== undefined) {
        addIssue(
          node,
          "MOJO_SOURCE_CALLABLE_SPECIALIZATION_BUDGET_EXCEEDED",
          `Finite Mojo callable specialization exceeds its ${maximumSpecializationEntries}-entry analysis budget.`,
        );
      }
      break;
    }
  }

  for (const declaration of required) {
    const descriptor = descriptors.get(declaration);
    if (descriptor === undefined || !descriptor.supported || descriptor.function === undefined) {
      addIssue(
        declaration,
        "MOJO_SOURCE_CALLABLE_SPECIALIZATION_SHAPE_UNSUPPORTED",
        "Finite Mojo callable specialization requires a concrete project function or class-method declaration body.",
      );
      continue;
    }
    if (input.libraryOutput && callableIsExternallyReachable(declaration, input.ast)) {
      addIssue(
        declaration,
        "MOJO_OPEN_LIBRARY_CALLABLE_SPECIALIZATION_UNSUPPORTED",
        "An exported generic callable reaches closed Mojo project dispatch and therefore has an open external specialization set.",
      );
      continue;
    }
    if ((variants.get(declaration) ?? []).length === 0) {
      addIssue(
        declaration,
        "MOJO_SOURCE_CALLABLE_SPECIALIZATION_UNCLOSED",
        "A reachable generic callable that requires closed Mojo project dispatch has no finite selected instantiation.",
      );
    }
  }

  const allocatedNames: string[] = [];
  const allocateName = createMojoNameAllocator(
    input.reservedNames,
    (name) => allocatedNames.push(name),
  );
  for (const [declaration, declarationVariants] of variants) {
    const descriptor = descriptors.get(declaration);
    if (descriptor === undefined) continue;
    declarationVariants.sort((left, right) => variantKey(left.targetArguments)
      .localeCompare(variantKey(right.targetArguments), "en"));
    for (const [index, variant] of declarationVariants.entries()) {
      variant.targetName = allocateName(`${descriptor.name}_specialization_${index + 1}`);
      Object.freeze(variant);
    }
  }
  methodRequests.sort((left, right) => {
    const file = input.ast.getFileName(input.ast.getSourceFile(left.declaration)).localeCompare(
      input.ast.getFileName(input.ast.getSourceFile(right.declaration)),
      "en",
    );
    return file || input.ast.pos(left.declaration) - input.ast.pos(right.declaration) ||
      variantKey(left.targetArguments).localeCompare(variantKey(right.targetArguments), "en");
  });
  const representationTypes = Object.freeze([
    ...new Map([...variants.values()].flatMap((entries) => entries)
      .flatMap((variant) => variant.targetArguments)
      .filter((argument): argument is Extract<MojoTargetGenericArgument, { readonly kind: "type" }> =>
        argument.kind === "type")
      .map((argument) => [JSON.stringify(argument.type), argument.type] as const)).values(),
  ]);
  const plan: MojoSourceCallableSpecializationPlan = {
    issues: Object.freeze(issues),
    projectMethodRequests: Object.freeze(methodRequests),
    representationTypes,
    allocatedNames: Object.freeze(allocatedNames),
    requiresSpecialization(declaration) {
      return required.has(declaration);
    },
    variantsForCallable(declaration) {
      return Object.freeze((variants.get(declaration) ?? []).filter(
        (variant): variant is MojoSourceCallableSpecializationVariant =>
          variant.targetName !== undefined,
      ));
    },
    variantForCall(declaration, targetArguments) {
      const matches = (variants.get(declaration) ?? []).filter((variant) =>
        variant.targetName !== undefined &&
        mojoTargetGenericArgumentsEqual(variant.targetArguments, targetArguments));
      return matches.length === 1
        ? matches[0] as MojoSourceCallableSpecializationVariant
        : undefined;
    },
  };
  return Object.freeze(plan);
}

function createCallableDescriptors(
  functions: readonly MojoAnalyzedFunction[],
  callableExpressionNodes: ReadonlySet<Node>,
  callableExpressionSelections: WeakMap<Node, MojoCallableExpressionSelection>,
): ReadonlyMap<Node, CallableDescriptor> {
  const descriptors = new Map<Node, CallableDescriptor>();
  for (const function_ of functions) {
    descriptors.set(function_.declaration, Object.freeze({
      declaration: function_.declaration,
      function: function_,
      typeParameters: function_.typeParameters,
      name: function_.name,
      supported: function_.kind === "function" || function_.kind === "method",
    }));
  }
  for (const expression of callableExpressionNodes) {
    if (descriptors.has(expression)) continue;
    const selection = callableExpressionSelections.get(expression);
    if (selection === undefined) continue;
    descriptors.set(expression, Object.freeze({
      declaration: expression,
      typeParameters: selection.typeParameters,
      name: "callable",
      supported: false,
    }));
  }
  return descriptors;
}

function enclosingCallable(
  node: Node,
  ast: AstReader,
  descriptors: ReadonlyMap<Node, CallableDescriptor>,
): CallableDescriptor | undefined {
  let current = ast.parent(node);
  while (current !== undefined) {
    const descriptor = descriptors.get(current);
    if (descriptor !== undefined) return descriptor;
    if (isCallableBoundary(current, ast)) return undefined;
    current = ast.parent(current);
  }
  return undefined;
}

function isCallableBoundary(node: Node, ast: AstReader): boolean {
  return ast.is.IsFunctionDeclaration(node) || ast.is.IsFunctionExpression(node) ||
    ast.is.IsArrowFunction(node) || ast.is.IsMethodDeclaration(node) ||
    ast.is.IsGetAccessorDeclaration(node) || ast.is.IsSetAccessorDeclaration(node) ||
    ast.is.IsConstructorDeclaration(node);
}

function requiredCallableSpecializations(
  sourceCalls: readonly SourceCallEdge[],
  projectMethodCalls: readonly ProjectMethodEdge[],
): ReadonlySet<Node> {
  const required = new Set<Node>();
  for (const edge of projectMethodCalls) {
    if (edge.caller !== undefined &&
      argumentsUseParameters(edge.targetArguments, edge.caller.typeParameters)) {
      required.add(edge.caller.declaration);
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of sourceCalls) {
      if (!required.has(edge.callee) || edge.caller === undefined ||
        !argumentsUseParameters(edge.targetArguments, edge.caller.typeParameters) ||
        required.has(edge.caller.declaration)) continue;
      required.add(edge.caller.declaration);
      changed = true;
    }
  }
  return required;
}

function substitutionsFor(
  parameters: readonly MojoAnalyzedTypeParameter[],
  arguments_: readonly MojoTargetGenericArgument[],
): MojoTargetTypeSubstitutions | undefined {
  if (parameters.length !== arguments_.length) return undefined;
  const types = new Map<string, MojoTargetTypeRef>();
  const values = new Map<string, MojoTargetGenericArgument>();
  const origins = new Map<string, import("../../target-model/origins/model.js").MojoOriginRef>();
  for (const [index, parameter] of parameters.entries()) {
    const argument = arguments_[index];
    const keys = [parameter.name, parameter.identity];
    if (parameter.kind === "type" && argument?.kind === "type") {
      for (const key of keys) types.set(key, argument.type);
    } else if (parameter.kind === "origin" && argument?.kind === "origin") {
      for (const key of keys) origins.set(key, argument.origin);
    } else if (parameter.kind === "value" && argument !== undefined &&
      argument.kind !== "type" && argument.kind !== "type-expression" &&
      argument.kind !== "origin" && argument.kind !== "unbound") {
      for (const key of keys) values.set(key, argument);
    } else {
      return undefined;
    }
  }
  return Object.freeze({ types, values, origins, packs: new Map() });
}

function argumentsUseParameters(
  arguments_: readonly MojoTargetGenericArgument[],
  parameters: readonly { readonly name: string; readonly identity: string }[],
): boolean {
  const keys = parameterKeys(parameters);
  return [...genericArgumentParameterKeys(arguments_)].some((key) => keys.has(key));
}

function parameterKeys(
  parameters: readonly { readonly name: string; readonly identity: string }[],
): ReadonlySet<string> {
  return new Set(parameters.flatMap((parameter) => [parameter.name, parameter.identity]));
}

function genericArgumentParameterKeys(
  arguments_: readonly MojoTargetGenericArgument[],
): ReadonlySet<string> {
  const output = new Set<string>();
  for (const argument of arguments_) collectGenericArgumentParameters(argument, output);
  return output;
}

function collectGenericArgumentParameters(
  argument: MojoTargetGenericArgument,
  output: Set<string>,
): void {
  if (argument.kind === "type") collectTypeParameters(argument.type, output);
  else if (argument.kind === "value-reference" && argument.path.length === 1) {
    output.add(argument.path[0]!);
  } else if (argument.kind === "origin" && argument.origin.kind === "parameter") {
    output.add(argument.origin.name);
  }
}

function collectTypeParameters(type: MojoTargetTypeRef, output: Set<string>): void {
  if (type.kind === "type-parameter") {
    output.add(type.identity ?? type.name);
    return;
  }
  switch (type.kind) {
    case "target-named":
      for (const argument of type.genericArguments ?? []) collectGenericArgumentParameters(argument, output);
      return;
    case "list":
    case "fixed-array": collectTypeParameters(type.element, output); return;
    case "dictionary": collectTypeParameters(type.key, output); collectTypeParameters(type.value, output); return;
    case "future": collectTypeParameters(type.output, output); return;
    case "optional":
    case "reference": collectTypeParameters(type.value, output); return;
    case "union": for (const member of type.members) collectTypeParameters(member, output); return;
    case "tuple": for (const element of type.elements) collectTypeParameters(element, output); return;
    case "associated":
      collectTypeParameters(type.owner, output);
      for (const argument of type.genericArguments) collectGenericArgumentParameters(argument, output);
      return;
    case "callable":
    case "function":
      for (const parameter of type.parameters) collectTypeParameters(parameter.type, output);
      collectTypeParameters(type.result, output);
      if (type.errorType !== undefined) collectTypeParameters(type.errorType, output);
      return;
    default: return;
  }
}

function callableIsExternallyReachable(declaration: Node, ast: AstReader): boolean {
  if (ast.hasModifierKind(declaration, "export")) return true;
  if (!ast.is.IsMethodDeclaration(declaration) || ast.hasModifierKind(declaration, "private") ||
    ast.hasModifierKind(declaration, "protected")) return false;
  const owner = ast.parent(declaration);
  return owner !== undefined && ast.hasModifierKind(owner, "export");
}

function variantCount(variants: ReadonlyMap<Node, readonly MutableVariant[]>): number {
  let count = 0;
  for (const entries of variants.values()) count += entries.length;
  return count;
}

function variantKey(arguments_: readonly MojoTargetGenericArgument[]): string {
  return JSON.stringify(arguments_, (name, value) =>
    name === "lifecycle" || name === "lifecycleRequirement" ||
      name === "lifecycleRequirements" ? undefined : value);
}
