import { createMojoProviderPackage, mojoLifecycleTraitTargetType, mojoNamedTargetType } from "../../dist/public/provider.js";

export function mutationProvider({ field = false, alter = (definition) => definition } = {}) {
  const exportId = "fixture.source.Counter";
  const receiver = mojoNamedTargetType("fixture.native.Counter", ["native_mutation"], "Counter");
  const integer = { kind: "source-primitive", name: "int32" };
  const floating = { kind: "source-primitive", name: "float64" };
  const parameter = { convention: "imm", position: "positional" };
  return createMojoProviderPackage(alter({
    id: "@test/mojo-mutations", displayName: "Selected mutation ABI", version: "1", runtimePackages: [],
    modules: [{ moduleSpecifier: "test:mutation", providerModuleId: "fixture.module", exports: [{
      id: exportId, name: "Counter", kind: "class", members: [{
        id: "fixture.member.value", name: "value", kind: "property", type: integer,
      }, {
        id: "fixture.member.global", name: "global", kind: "property", static: true, type: integer,
      }, {
        id: "fixture.member.index", name: "item", kind: "indexer", signatures: [{
          id: "fixture.signature.index", parameters: [{ name: "index", type: integer }], returnType: integer,
        }],
      }],
    }] }],
    types: [{ exportId, sourceGenericParameters: [], targetType: receiver,
      conformances: ["copyable", "movable", "deinitializable"].map((lifecycleRole) => ({
        trait: mojoLifecycleTraitTargetType(lifecycleRole), lifecycleRole,
      })),
    }],
    operations: [{
      exportId, memberId: "fixture.member.value", operationKind: "property", receiverType: receiver,
      parameterTypes: [], resultType: integer,
      target: { kind: "property-read", receiver: "imm", access: { kind: "method", name: "read" } },
    }, {
      exportId, memberId: "fixture.member.value", operationKind: "property-set", receiverType: receiver,
      parameterTypes: [floating], resultType: { kind: "unit" },
      target: { kind: "property-write", receiver: field ? "mut" : "imm", value: parameter,
        access: { kind: field ? "member" : "method", name: field ? "stored" : "write" } },
    }, {
      exportId, memberId: "fixture.member.index", signatureId: "fixture.signature.index", operationKind: "indexer", receiverType: receiver,
      parameterTypes: [integer], resultType: integer,
      target: { kind: "index-read", receiver: "imm", index: parameter, access: { kind: "method", name: "read_index" } },
    }, {
      exportId, memberId: "fixture.member.index", signatureId: "fixture.signature.index", operationKind: "index-set", receiverType: receiver,
      parameterTypes: [integer, floating], resultType: { kind: "unit" },
      target: { kind: "index-write", receiver: field ? "mut" : "imm", index: parameter, value: parameter,
        access: field ? { kind: "element" } : { kind: "method", name: "write_index" } },
    }, {
      exportId, memberId: "fixture.member.global", operationKind: "property", parameterTypes: [], resultType: integer,
      target: { kind: "function-read", modulePath: ["native_mutation"], name: "read_global" },
    }, {
      exportId, memberId: "fixture.member.global", operationKind: "property-set", parameterTypes: [floating], resultType: { kind: "unit" },
      target: { kind: "function-write", modulePath: ["native_mutation"], name: "write_global", value: parameter },
    }],
  }));
}

export const mutationSource = `
import { Counter } from "test:mutation";
import type { int32 } from "@tsonic/core/types.js";
export function change(counter: Counter): int32 {
  const old = counter.value++;
  const increased = counter.value += 2;
  const index: int32 = 0;
  const previous = counter[index]++;
  const next = ++counter[index];
  const assigned = counter.value = 9;
  const globalOld = Counter.global++;
  const globalNext = ++Counter.global;
  const globalWritten = Counter.global += 3;
  return old + increased + previous + next + assigned + globalOld + globalNext + globalWritten;
}
`;

export function mutationSourceFor(field) {
  return field
    ? `import type { MutRef, MutOrigin } from "@tsonic/mojo/types.js";\n${mutationSource}`
        .replace("change(counter: Counter)", "change<O extends MutOrigin>(counter: MutRef<Counter, O>)")
    : mutationSource;
}

export const mutationNative = `from std.memory import ArcPointer
from std.ffi import external_call

@fieldwise_init
struct State(Copyable, Movable):
    var stored: Float64

struct Counter(Copyable, Movable):
    var state: ArcPointer[State]
    var stored: Float64

    def __init__(out self):
        self.state = ArcPointer(State(1.0))
        self.stored = 1.0

    def read(self) -> Int32:
        return Int32(self.state[].stored)

    def write(self, value: Float64):
        self.state[].stored = value

    def read_index(self, index: Int32) -> Int32:
        return self.read() + index

    def write_index(self, index: Int32, value: Float64):
        self.write(value - Float64(index))

    def __setitem__(mut self, index: Int32, value: Float64):
        self.stored = value - Float64(index)

    def __getitem__(self, index: Int32) -> Float64:
        return self.stored + Float64(index)

def read_global() -> Int32:
    return external_call["mutation_read", Int32]()

def write_global(value: Float64):
    external_call["mutation_write", NoneType](value)
`;

export const mutationC = `#include <stdint.h>
static double value = 1;
int32_t mutation_read(void) { return (int32_t)value; }
void mutation_write(double next) { value = next; }
`;
