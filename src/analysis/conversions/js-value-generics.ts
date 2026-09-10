import type { MojoJsValueGenericParameter } from "../../target-model/conversions/js-value-graph.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";

export function sourceValueGenericParameters(
  type: MojoTargetTypeRef,
  declarations: ReadonlyMap<string, MojoJsValueGenericParameter>,
): readonly MojoJsValueGenericParameter[] | undefined {
  const selected = new Map<string, MojoJsValueGenericParameter>();
  const visiting = new Set<string>();
  const visit = (type: MojoTargetTypeRef): boolean => {
    if (type.kind === "type-parameter") {
      if (type.identity === undefined) return false;
      if (visiting.has(type.identity)) return true;
      const declaration = declarations.get(type.identity);
      if (declaration?.kind !== "type" || declaration.variadic) return false;
      visiting.add(type.identity);
      if (!declaration.constraints.every(visit)) return false;
      selected.set(type.identity, Object.freeze({
        kind: "type", identity: declaration.identity, name: declaration.name,
        position: "positional", variadic: false, constraints: declaration.constraints,
      }));
      return true;
    }
    switch (type.kind) {
      case "target-named":
        return (type.genericArguments ?? []).every((argument) =>
          argument.kind === "type" ? visit(argument.type) :
            argument.kind === "integer" || argument.kind === "boolean" || argument.kind === "static-string");
      case "optional": return visit(type.value);
      case "union": return type.members.every(visit);
      case "tuple": return type.elements.every(visit);
      case "list": return visit(type.element);
      case "dictionary": return visit(type.key) && visit(type.value);
      case "fixed-array": return type.length.kind !== "parameter" && visit(type.element);
      case "associated":
      case "compiler-expression":
      case "reference":
      case "function":
      case "callable":
      case "future": return false;
      default: return true;
    }
  };
  if (!visit(type)) return undefined;
  const parameters = [...selected.values()];
  if (new Set(parameters.map((parameter) => parameter.name)).size !== parameters.length) return undefined;
  return Object.freeze(parameters);
}
