import type {
  MojoAnalyzedClass,
  MojoAnalyzedInterface,
  MojoProjectConstruction,
} from "../program/model.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export function selectMojoProjectConstruction(
  declaration: MojoAnalyzedClass | MojoAnalyzedInterface,
  type: MojoTargetTypeRef,
): MojoProjectConstruction | undefined {
  if (type.kind !== "target-named" || declaration.targetType.kind !== "target-named" ||
    type.id !== declaration.targetType.id) return undefined;
  if (declaration.stateStorage === "direct") {
    return Object.freeze({ kind: "initializer", type });
  }
  return Object.freeze({
    kind: "factory",
    type,
    modulePath: type.modulePath,
    name: declaration.constructorFactoryName,
    genericArguments: Object.freeze([...(type.genericArguments ?? [])]),
  });
}
