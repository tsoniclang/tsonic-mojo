import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import type { MojoAnalyzedProjectCallable } from "../program/model.js";
import type { MojoCallAnalysisContext } from "./calls.js";
import { selectedMojoArgumentCarrier } from "./call-argument-carriers.js";

export function selectMojoProjectGenericCarrier(
  parameter: MojoAnalyzedProjectCallable["contract"]["typeParameters"][number],
  selected: NonNullable<ResolvedSourceCallInfo["sourceSelectedMethodTypeArguments"]>[number],
  call: ResolvedSourceCallInfo,
  contract: MojoAnalyzedProjectCallable["contract"],
  resolve: (type: Type, authored?: Node) => MojoTargetTypeRef | undefined,
  context: MojoCallAnalysisContext,
): MojoTargetTypeRef | undefined {
  const sourceCarrier = resolve(selected.selectedType, selected.explicitTypeNode);
  if (selected.explicitTypeNode !== undefined) return sourceCarrier;
  const direct: MojoTargetTypeRef[] = [];
  const storage: MojoTargetTypeRef[] = [];
  const collect = (declared: MojoTargetTypeRef, actual: MojoTargetTypeRef, invariant: boolean): void => {
    if (declared.kind === "type-parameter") {
      if (declared.identity === parameter.identity) (invariant ? storage : direct).push(actual);
      return;
    }
    if (declared.kind === "optional") {
      if (actual.kind !== "undefined" && actual.kind !== "null") {
        collect(declared.value, actual.kind === "optional" ? actual.value : actual, invariant);
      }
      return;
    }
    if (declared.kind === "target-named" && actual.kind === "target-named" && declared.id === actual.id) {
      const expectedArguments = declared.genericArguments ?? [];
      const actualArguments = actual.genericArguments ?? [];
      if (expectedArguments.length !== actualArguments.length) return;
      expectedArguments.forEach((argument, index) => {
        const value = actualArguments[index]!;
        if (argument.kind === "type" && value.kind === "type") collect(argument.type, value.type, true);
      });
    } else if (declared.kind === "list" && actual.kind === "list") {
      collect(declared.element, actual.element, true);
    } else if (declared.kind === "fixed-array" && actual.kind === "fixed-array" &&
      mojoTargetTypeEquals({ ...declared, element: { kind: "unit" } }, { ...actual, element: { kind: "unit" } })) {
      collect(declared.element, actual.element, true);
    } else if (declared.kind === "dictionary" && actual.kind === "dictionary") {
      collect(declared.key, actual.key, true);
      collect(declared.value, actual.value, true);
    } else if (declared.kind === "tuple" && actual.kind === "tuple" && declared.elements.length === actual.elements.length) {
      declared.elements.forEach((element, index) => collect(element, actual.elements[index]!, true));
    } else if (declared.kind === "reference" && actual.kind === "reference" && declared.mutable === actual.mutable) {
      collect(declared.value, actual.value, true);
    }
  };
  for (const binding of call.sourceArgumentBindings) {
    const declared = contract.parameters[binding.sourceParameterIndex];
    const actual = selectedMojoArgumentCarrier(context.source.ast, call, binding, context.expressionTypes, resolve);
    if (declared === undefined || actual === undefined || binding.sourceForm === "spread-sequence") continue;
    collect(declared.type, actual.type, false);
  }
  if (storage.length !== 0) {
    return storage.every((type) => mojoTargetTypeEquals(type, storage[0]!)) ? storage[0] : undefined;
  }
  const candidates = direct.filter((type) => type.kind !== "undefined" && type.kind !== "null");
  return candidates.length !== 0 && candidates.every((type) => mojoTargetTypeEquals(type, candidates[0]!))
    ? candidates[0]
    : sourceCarrier;
}
