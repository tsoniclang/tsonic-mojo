import {
  readTsonicKeepAlive, readTsonicRawMemoryOperation, readTsonicDataLayout,
  resolveTsonicMemoryLayoutObservation, selectTsonicRawLocationOperation,
} from "@tsonic/source-core/facts";
import type { Node, ResolvedSourceCallInfo, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MojoMemoryAnalysis } from "../storage/memory-metadata.js";
import type { MojoTargetTypeRef } from "../../target-model/types/model.js";
import type { MojoMemoryOperationSelection } from "../../target-model/operations/native-memory.js";
import { mojoTypedLocationPointee, mojoTypedLocationType } from "../../target-model/types/typed-locations.js";
import { mojoTargetTypeEquals } from "../../target-model/types/equality.js";
import { mojoRawPointerTargetType } from "./raw-pointers.js";
import { hasExplicitUnsafeContext } from "../safety/explicit-context.js";
import { selectMojoNativeLayout } from "../storage/native-layout.js";
import { unwrapMojoStorageExpression } from "../storage/locations.js";
import type { MojoProviderSemantics } from "../../providers/packages/model.js";

export type MojoMemoryAnalysisResult =
  | { readonly kind: "not-memory" }
  | { readonly kind: "resolved"; readonly selection: MojoMemoryOperationSelection }
  | { readonly kind: "unsupported"; readonly code: string; readonly reason: string };

export function analyzeMojoMemoryOperation(input: {
  readonly call: Node;
  readonly selected: ResolvedSourceCallInfo;
  readonly source: TargetSourceProgram;
  readonly memory: MojoMemoryAnalysis;
  readonly providers: MojoProviderSemantics;
  readonly expressionTypes: WeakMap<Node, MojoTargetTypeRef>;
  readonly resolveType: (type: Type, authored?: Node) => MojoTargetTypeRef | undefined;
}): MojoMemoryAnalysisResult {
  const facts = input.source.sourceFacts;
  const observation = resolveTsonicMemoryLayoutObservation(facts, input.call);
  if (observation?.kind === "rejected") return reject(observation.reason);
  if (observation?.kind === "resolved") {
    const resultType = input.resolveType(observation.query.resultType);
    return resultType === undefined ? reject("Layout observation has no exact selected result carrier.")
      : resolved({ kind: "native-memory", operation: "observation", value: observation.value, resultType });
  }
  const keepAlive = readTsonicKeepAlive(facts, input.call);
  if (keepAlive !== undefined) {
    const inputType = input.expressionTypes.get(keepAlive.valueExpression) ?? input.resolveType(keepAlive.valueType);
    if (keepAlive.call !== input.call || !argumentsMatch([keepAlive.valueExpression]) || inputType === undefined) return reject("Keep-alive requires its exact selected value and carrier.");
    return resolved({ kind: "native-memory", operation: "keep-alive", expression: keepAlive.valueExpression, inputType, resultType: Object.freeze({ kind: "unit" }) });
  }
  const operation = readTsonicRawMemoryOperation(facts, input.call);
  if (operation === undefined) return { kind: "not-memory" };
  if (operation.call !== input.call || operation.resultType !== input.selected.sourceResultType) return reject("Native memory evidence is not owned by this selected source call.");
  const raw: MojoTargetTypeRef = Object.freeze({ kind: "optional", value: mojoRawPointerTargetType() });
  if (operation.operation === "reinterpret" || operation.operation === "to-raw") {
    const selected = selectTsonicRawLocationOperation(input.source.ast, facts, input.call);
    if (selected === undefined || selected.kind === "rejected") return reject(selected?.reason ?? "Native memory selection has no finalized source layout.");
    if (!argumentsMatch([selected.expression, operation.layoutExpression])) return reject("Native memory arguments disagree with retained source evidence.");
    if (operation.operation === "reinterpret" && !hasExplicitUnsafeContext(input.call, input.source)) return reject("Native memory reinterpretation requires an explicit unsafeContext region.");
    const type = input.resolveType(selected.layout.sourceType, selected.layout.explicitTypeNode);
    const layout = type === undefined ? undefined : selectMojoNativeLayout(selected.layout, type, input.source, input.providers);
    if (layout === undefined || type === undefined) return reject("The selected layout has no closed native Mojo scalar, array or exact provider-field representation; opaque/reference carriers are not physical value layouts.");
    if (operation.operation === "to-raw") {
      const pointerType = input.expressionTypes.get(selected.expression) ?? input.resolveType(operation.pointerType);
      const pointee = mojoTypedLocationPointee(pointerType);
      if (pointee === undefined || !mojoTargetTypeEquals(pointee, type)) return reject("Typed storage and its selected physical layout require different Mojo carriers.");
      const backing = input.memory.backing.resolve(selected.expression);
      if (backing.kind === "unproven") return reject(backing.issues.map((issue) => issue.reason).join(" "));
      for (const origin of backing.origins) {
        if (origin.operation === "address-of") {
          const storage = unwrapMojoStorageExpression(origin.storageExpression, input);
          if (!input.source.ast.is.IsIdentifier(storage) && !input.memory.nativeArrayElement(storage, input.expressionTypes)) return reject("Native address extraction requires a physical storage root; a logical member accessor is not a native field pointer.");
        }
      }
    }
    const pointer: MojoTargetTypeRef = Object.freeze({ kind: "optional", value: mojoTypedLocationType(type) });
    return resolved({ kind: "native-memory", operation: operation.operation, expression: selected.expression,
      inputType: operation.operation === "reinterpret" ? raw : pointer, resultType: operation.operation === "reinterpret" ? pointer : raw, layout });
  }
  const abi = readTsonicDataLayout(facts, operation.dataLayoutExpression);
  if (abi === undefined) return reject("Address arithmetic requires the exact finalized data-layout token.");
  if (operation.operation === "byte-offset") {
    if (!argumentsMatch([operation.rawExpression, operation.offsetExpression, operation.dataLayoutExpression])) return reject("Byte offset operands disagree with selected source evidence.");
    const offsetType: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: operation.offsetSignedness === "signed" ? "int128" : "uint128" });
    return resolved({ kind: "native-memory", operation: "byte-offset", expression: operation.rawExpression, inputType: raw,
      offset: operation.offsetExpression, offsetType, signed: operation.offsetSignedness === "signed", addressWidth: abi.addressWidth, resultType: raw });
  }
  if (abi.addressWidth !== operation.addressWidth) return reject("Address integer and selected ABI widths disagree.");
  const integer: MojoTargetTypeRef = Object.freeze({ kind: "source-primitive", name: operation.addressWidth === 64 ? "uint64" : "uint32" });
  const expression = operation.operation === "raw-to-address-integer" ? operation.rawExpression : operation.addressExpression;
  if (!argumentsMatch([expression, operation.dataLayoutExpression])) return reject("Address integer operands disagree with selected source evidence.");
  return resolved({ kind: "native-memory", operation: operation.operation, expression, addressWidth: operation.addressWidth,
    inputType: operation.operation === "raw-to-address-integer" ? raw : integer, resultType: operation.operation === "raw-to-address-integer" ? integer : raw });

  function argumentsMatch(expected: readonly Node[]): boolean {
    return input.selected.sourceArguments.length === expected.length && input.selected.sourceArguments.every((argument, index) => argument.expression === expected[index]);
  }
}

function reject(reason: string): MojoMemoryAnalysisResult {
  return { kind: "unsupported", code: "MOJO_NATIVE_MEMORY_CONTRACT_NOT_PROVEN", reason };
}

function resolved(selection: MojoMemoryOperationSelection): MojoMemoryAnalysisResult {
  return { kind: "resolved", selection: Object.freeze(selection) };
}
