import type { AstReader, Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import { Node_Expression } from "@tsonic/target-api/source";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import { collectionShape } from "../../policy/conversions/javascript-conversions.js";
import type { MojoSelectedArgumentBinding } from "./call-argument-conversions.js";

export interface MojoSelectedArgumentCarrier {
  readonly expression: Node;
  readonly type: MojoTargetTypeRef;
  readonly containerType?: MojoTargetTypeRef;
}

export function selectedMojoArgumentCarrier(
  ast: AstReader,
  call: ResolvedSourceCallInfo,
  binding: MojoSelectedArgumentBinding,
  expressionTypes: WeakMap<Node, MojoTargetTypeRef>,
  resolve: (type: Type) => MojoTargetTypeRef | undefined,
): MojoSelectedArgumentCarrier | undefined {
  const argument = call.sourceArguments[binding.sourceArgumentIndex];
  if (argument === undefined) return undefined;
  if (binding.sourceForm === "value") {
    const type = expressionTypes.get(argument.expression) ?? resolve(binding.selectedArgumentType);
    return type === undefined ? undefined : Object.freeze({ expression: argument.expression, type });
  }
  const expression = Node_Expression(ast, argument.expression);
  if (expression === undefined) return undefined;
  const containerType = expressionTypes.get(expression) ??
    expressionTypes.get(argument.expression) ?? resolve(argument.type);
  if (containerType === undefined) return undefined;
  const type = binding.sourceForm === "spread-sequence"
    ? containerType
    : selectedMojoSpreadElementType(containerType, binding.spreadElementIndex) ??
      resolve(binding.selectedArgumentType);
  return type === undefined ? undefined : Object.freeze({ expression, type, containerType });
}

export function selectedMojoSpreadElementType(
  container: MojoTargetTypeRef,
  index: number | undefined,
): MojoTargetTypeRef | undefined {
  if (index === undefined || !Number.isSafeInteger(index) || index < 0) return undefined;
  if (container.kind === "tuple") return container.elements[index];
  if (container.kind === "fixed-array") return container.element;
  return collectionShape(container)?.element;
}
