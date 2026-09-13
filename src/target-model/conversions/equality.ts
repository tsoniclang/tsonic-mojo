import { mojoTargetTypeEquals, mojoTargetGenericArgumentsEqual } from "../types/equality.js";
import type { MojoTargetTypeRef } from "../types/model.js";
import type { MojoTruthinessConversion, MojoValueConversion } from "./model.js";
import type { MojoJsValueGraph, MojoJsValueProjection } from "./js-value-graph.js";
import { mojoSourceValueFunctionEquals } from "./source-value-function.js";

function entriesEqual<Value>(left: readonly Value[], right: readonly Value[], equals: (left: Value, right: Value) => boolean): boolean {
  return left.length === right.length && left.every((value, index) => equals(value, right[index]!));
}

function optionalTypeEquals(left: MojoTargetTypeRef | undefined, right: MojoTargetTypeRef | undefined): boolean {
  return left === undefined || right === undefined ? left === right : mojoTargetTypeEquals(left, right);
}

function optionalConversionEquals(left: MojoValueConversion | undefined, right: MojoValueConversion | undefined): boolean {
  return left === undefined || right === undefined ? left === right : mojoValueConversionEquals(left, right);
}

export function mojoValueConversionEquals(left: MojoValueConversion, right: MojoValueConversion): boolean {
  if (left === right) return true;
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "provider-record": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) &&
        mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        entriesEqual(left.fields, candidate.fields, (field, other) =>
          field.memberId === other.memberId && field.targetName === other.targetName &&
          mojoTargetTypeEquals(field.sourceType, other.sourceType) && mojoTargetTypeEquals(field.targetType, other.targetType) &&
          mojoValueConversionEquals(field.conversion, other.conversion) && field.read.kind === other.read.kind &&
          (field.read.kind === "structural" ? other.read.kind === "structural" && field.read.index === other.read.index :
            other.read.kind !== "structural" && field.read.declaration === other.read.declaration && field.read.name === other.read.name));
    }
    case "identity":
    case "undefined-to-unit":
    case "js-to-native-string": return true;
    case "primitive-cast":
    case "reference-copy":
    case "native-to-js-string":
    case "optional-none": return mojoTargetTypeEquals(left.targetType, (right as typeof left).targetType);
    case "project-view":
    case "native-error-result-unwrap": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType);
    }
    case "js-box": {
      const candidate = right as typeof left;
      return left.source === candidate.source && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        (left.source !== "number" && left.source !== "bigint" ||
          (candidate.source === "number" || candidate.source === "bigint") && mojoTargetTypeEquals(left.sourceType, candidate.sourceType));
    }
    case "callable-adapt": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) &&
        left.parameters.kind === candidate.parameters.kind &&
        (left.parameters.kind !== "prefix" || candidate.parameters.kind === "prefix" &&
          entriesEqual(left.parameters.copies, candidate.parameters.copies, (copy, other) => copy === other)) &&
        mojoTargetTypeEquals(left.targetType, candidate.targetType) && left.result === candidate.result && left.error === candidate.error &&
        optionalTypeEquals(left.sourceErrorType, candidate.sourceErrorType) && optionalConversionEquals(left.errorConversion, candidate.errorConversion) &&
        optionalConversionEquals(left.resultConversion, candidate.resultConversion);
    }
    case "js-callback-truthiness": {
      const candidate = right as typeof left;
      return left.source === candidate.source && mojoTargetTypeEquals(left.targetType, candidate.targetType);
    }
    case "js-truthiness": return truthinessEquals(left.conversion, (right as typeof left).conversion);
    case "js-value-graph": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        mojoJsValueGraphEquals(left.graph, candidate.graph);
    }
    case "provider-native-view": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) && mojoSourceValueFunctionEquals(left.factory, candidate.factory);
    }
    case "js-value-extract": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) &&
        mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        mojoSourceValueFunctionEquals(left.extraction, candidate.extraction);
    }
    case "js-data-rest": {
      const candidate = right as typeof left;
      return left.source === candidate.source && mojoTargetTypeEquals(left.sourceType, candidate.sourceType) &&
        mojoTargetTypeEquals(left.targetType, candidate.targetType) && mojoTargetTypeEquals(left.elementType, candidate.elementType) &&
        mojoValueConversionEquals(left.elementConversion, candidate.elementConversion);
    }
    case "collection-map": {
      const candidate = right as typeof left;
      return left.source === candidate.source && left.target === candidate.target &&
        mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        mojoTargetTypeEquals(left.sourceElementType, candidate.sourceElementType) && mojoTargetTypeEquals(left.targetElementType, candidate.targetElementType) &&
        optionalConversionEquals(left.elementConversion, candidate.elementConversion);
    }
    case "optional-some": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.targetType, candidate.targetType) && mojoValueConversionEquals(left.valueConversion, candidate.valueConversion);
    }
    case "optional-map":
    case "optional-present": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        mojoValueConversionEquals(left.valueConversion, candidate.valueConversion);
    }
    case "optional-to-union": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        mojoTargetTypeEquals(left.absentType, candidate.absentType) && mojoValueConversionEquals(left.valueConversion, candidate.valueConversion);
    }
    case "union-to-optional": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        entriesEqual(left.presentMembers, candidate.presentMembers, (member, other) =>
          mojoTargetTypeEquals(member.sourceType, other.sourceType) && mojoValueConversionEquals(member.conversion, other.conversion));
    }
    case "union-inject": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.targetType, candidate.targetType) && mojoTargetTypeEquals(left.memberType, candidate.memberType) &&
        mojoValueConversionEquals(left.valueConversion, candidate.valueConversion);
    }
    case "union-map": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        entriesEqual(left.members, candidate.members, (member, other) =>
          mojoTargetTypeEquals(member.sourceType, other.sourceType) && mojoTargetTypeEquals(member.targetType, other.targetType) &&
          mojoValueConversionEquals(member.conversion, other.conversion));
    }
    case "narrowed-union-map": {
      const candidate = right as typeof left;
      return mojoTargetTypeEquals(left.sourceType, candidate.sourceType) && mojoTargetTypeEquals(left.targetType, candidate.targetType) &&
        mojoTargetTypeEquals(left.selectedType, candidate.selectedType) && entriesEqual(left.members, candidate.members, (member, other) =>
          mojoTargetTypeEquals(member.sourceType, other.sourceType) && mojoValueConversionEquals(member.conversion, other.conversion));
    }
  }
}

function truthinessEquals(left: MojoTruthinessConversion, right: MojoTruthinessConversion): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "optional") return right.kind === "optional" &&
    mojoTargetTypeEquals(left.sourceType, right.sourceType) && truthinessEquals(left.value, right.value);
  if (left.kind === "union") return right.kind === "union" && mojoTargetTypeEquals(left.sourceType, right.sourceType) &&
    entriesEqual(left.members, right.members, (member, other) => mojoTargetTypeEquals(member.type, other.type) && truthinessEquals(member.conversion, other.conversion));
  return true;
}

export function mojoJsValueGraphEquals(left: MojoJsValueGraph, right: MojoJsValueGraph): boolean {
  return left.protocol === right.protocol && left.root === right.root && entriesEqual(left.definitions, right.definitions, projectionEquals);
}

function projectionEquals(left: MojoJsValueProjection, right: MojoJsValueProjection): boolean {
  if (left.kind !== right.kind || left.id !== right.id || !mojoTargetTypeEquals(left.sourceType, right.sourceType) ||
    !entriesEqual(left.genericParameters, right.genericParameters, (parameter, other) =>
      parameter.identity === other.identity && parameter.name === other.name && parameter.kind === other.kind &&
      parameter.position === other.position && parameter.variadic === other.variadic &&
      entriesEqual(parameter.constraints, other.constraints, mojoTargetTypeEquals) &&
      mojoTargetGenericArgumentsEqual(parameter.defaultArgument === undefined ? [] : [parameter.defaultArgument],
        other.defaultArgument === undefined ? [] : [other.defaultArgument]))) return false;
  switch (left.kind) {
    case "scalar": return mojoValueConversionEquals(left.conversion, (right as typeof left).conversion);
    case "provider": return mojoSourceValueFunctionEquals(left.factory, (right as typeof left).factory);
    case "optional": return left.value === (right as typeof left).value;
    case "union": return entriesEqual(left.members, (right as typeof left).members, (member, other) =>
      member.projection === other.projection && mojoTargetTypeEquals(member.sourceType, other.sourceType));
    case "polymorphic": {
      const candidate = right as typeof left;
      return left.baseProjection === candidate.baseProjection && entriesEqual(left.alternatives, candidate.alternatives, (alternative, other) =>
        alternative.projection === other.projection && mojoTargetTypeEquals(alternative.sourceType, other.sourceType));
    }
    case "array": return left.element === (right as typeof left).element && left.sourceCopy === (right as typeof left).sourceCopy;
    case "object": {
      const candidate = right as typeof left;
      if (left.sourceCopy !== candidate.sourceCopy || left.identity !== candidate.identity || left.prototypeIdentity !== candidate.prototypeIdentity ||
        !entriesEqual(left.accessors, candidate.accessors, (accessor, other) =>
          accessor.sourceName === other.sourceName && accessor.declaration === other.declaration && accessor.name === other.name &&
          accessor.resultProjection === other.resultProjection && mojoTargetTypeEquals(accessor.resultType, other.resultType)) ||
        !entriesEqual(left.fields, candidate.fields, (field, other) => {
          if (field.sourceName !== other.sourceName || field.projection !== other.projection || field.access.kind !== other.access.kind) return false;
          return field.access.kind === "structural" ? other.access.kind === "structural" && field.access.index === other.access.index :
            other.access.kind === "project" && field.access.declaration === other.access.declaration &&
            entriesEqual(field.access.path, other.access.path, (segment, otherSegment) => segment === otherSegment);
        })) return false;
      const method = left.toJson;
      const other = candidate.toJson;
      return method === undefined || other === undefined ? method === other :
        method.declaration === other.declaration && method.name === other.name && method.passesPropertyKey === other.passesPropertyKey &&
        method.resultProjection === other.resultProjection && mojoTargetTypeEquals(method.resultType, other.resultType);
    }
  }
}
