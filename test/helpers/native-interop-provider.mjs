import { createMojoProviderPackage } from "../../dist/public/provider.js";
import { projectMojoCompilerModule } from "../../dist/providers/compiler/projection/projection.js";

export function foreignProvider(change = (definition) => definition) {
  const primitive = (name) => ({ kind: "source-primitive", name });
  const source = [
    { id: "ffi.probe", name: "probe", kind: "function", signatures: [{ id: "ffi.probe.selected", parameters: [
      { name: "count", type: primitive("int32") }, { name: "values", type: { kind: "any" }, rest: true },
    ], returnType: { kind: "number" } }] },
    { id: "ffi.fixed", name: "fixed", kind: "function", signatures: [{ id: "ffi.fixed.selected", parameters: [
      { name: "value", type: primitive("int32") },
    ], returnType: primitive("int32") }] },
  ];
  return createMojoProviderPackage(change({
    id: "@test/mojo-c-abi", displayName: "Native C ABI proof", version: "1", runtimePackages: [],
    modules: [{ moduleSpecifier: "test:c-abi", providerModuleId: "test:c-abi", exports: source }],
    operations: source.map((declaration) => ({
      exportId: declaration.id, signatureId: declaration.signatures[0].id, operationKind: "call",
      parameterTypes: declaration.name === "probe" ? [primitive("int32"), { kind: "dynamic", domain: "source" }] : [primitive("int32")],
      resultType: declaration.name === "probe" ? primitive("float64") : primitive("int32"),
      target: { kind: "foreign-call", symbol: `native_${declaration.name}`, fixedParameterCount: 1,
        arguments: declaration.signatures[0].parameters.map((parameter) => ({
          convention: "imm", position: "positional", ...(parameter.rest ? { variadic: true } : {}),
        })),
      },
    })),
  }));
}

export const foreignSource = `
import { probe, fixed } from "test:c-abi";
import { unsafeContext } from "@tsonic/core/lang.js";
import type { int8, uint8, int32, uint64, float32 } from "@tsonic/core/types.js";
let order: int32 = 0;
function first(): int8 { order = order * 10 + 1; return -7; }
function second(): uint8 { order = order * 10 + 2; return 250; }
function third(): float32 { order = order * 10 + 3; return 1.5; }
export function run(): boolean {
  unsafeContext();
  const exact: uint64 = 9007199254740993n;
  const result = probe(4, first(), second(), third(), exact);
  const tuple: [int8, uint8, float32, uint64] = [-7, 250, 1.5, exact];
  return result === 244.5 && probe(4, ...tuple) === 244.5 && order === 123 &&
    probe(0) === 0 && fixed(21) === 42;
}
`;

export const foreignNative = `#include <stdarg.h>
#include <stdint.h>
double native_probe(int32_t count, ...) {
    if (count == 0) return 0;
    if (count != 4) return -1000;
    va_list arguments;
    va_start(arguments, count);
    int first = va_arg(arguments, int);
    int second = va_arg(arguments, int);
    double third = va_arg(arguments, double);
    uint64_t exact = va_arg(arguments, uint64_t);
    va_end(arguments);
    return exact == UINT64_C(9007199254740993) ? first + second + third : -2000;
}
int32_t native_fixed(int32_t value) { return value * 2; }
`;

export function borrowedProjection({ mutable, traitReceiver = false } = {}) {
  const primitive = { kind: "named", name: "Int32", arguments: [] };
  const parameter = { kind: "origin", name: "origin", passingKind: "positional", variadic: false,
    constraints: mutable === undefined ? [] : [{ kind: "named", name: mutable ? "MutOrigin" : "ImmOrigin",
      path: mutable ? "/std/origin/#mutorigin" : "/std/origin/#immorigin", arguments: [] }],
  };
  const reference = { kind: "reference", origin: "origin", target: primitive };
  const package_ = { id: "native-interop", alias: "native-interop", packageName: "native_borrow", version: "1",
    kind: "package", modules: [{ modulePath: [] }] };
  const module = {
    packageId: package_.id, packageVersion: package_.version, modulePath: [], moduleIdentity: "native-interop",
    availableExports: [{ name: "borrow", kind: "function" }, { name: "View", kind: traitReceiver ? "trait" : "struct" }],
    declarations: [{ kind: traitReceiver ? "trait" : "struct", identity: "native.View", name: "View",
      ...(traitReceiver ? {} : { genericParameters: [parameter] }),
      convention: "memory", parentTraits: [], aliases: [], fields: [], functions: [{
        identity: "native.View.read", name: "read", genericParameters: traitReceiver ? [parameter] : [],
        arguments: [{ name: "self", convention: traitReceiver ? "ref" : "imm", position: "positional",
          type: traitReceiver ? { kind: "reference", origin: "origin", target: { kind: "self", memberPath: [], arguments: [] } }
            : { kind: "self", memberPath: [], arguments: [] }, variadic: false }],
        result: { ...reference, origin: traitReceiver ? "origin" : "Self.origin" }, raises: false, asynchronous: false, static: false, implicitConversion: false, requiredImplementation: false,
      }],
    }], functions: [{
      identity: "native.borrow.exact", name: "borrow", genericParameters: [parameter],
      arguments: [{ name: "value", convention: "ref", position: "positional", type: reference, variadic: false }],
      result: reference, raises: false, asynchronous: false, static: true,
      implicitConversion: false, requiredImplementation: false,
    }],
  };
  return projectMojoCompilerModule({ packages: [package_] }, package_, module, {
    providerModuleId: "test:borrow", moduleSpecifier: "test:borrow", exports: [{ declarationName: "borrow", exportName: "borrow" }, { declarationName: "View", exportName: "View" }],
  });
}

export function borrowedProvider(options) {
  const projection = borrowedProjection(options);
  return createMojoProviderPackage({ id: "@test/mojo-borrow", displayName: "Native borrowed ABI proof", version: "1",
    runtimePackages: [], modules: [projection.declarationModel], types: projection.types, operations: projection.operations,
  });
}

export const borrowedSource = `
import { borrow } from "test:borrow";
import type { View } from "test:borrow";
import type { Origin, Ref, StaticOrigin, i32 } from "@tsonic/mojo/types.js";
export function relay<O extends Origin>(value: Ref<i32, O>): Ref<i32, O> {
  const alias: Ref<i32, O> = borrow<O>(value);
  return alias;
}
export function relayView<O extends Origin>(value: View<O>): Ref<i32, O> {
  const alias: Ref<i32, O> = value.read();
  return alias;
}
export function relayStatic(value: Ref<i32, StaticOrigin>): Ref<i32, StaticOrigin> {
  return borrow<StaticOrigin>(value);
}
`;

export const borrowedNative = `from std.memory import Pointer
from std.origin import ImmOrigin, MutOrigin
def borrow[origin: Origin](ref[origin] value: Int32) -> ref[origin] Int32:
    return value
@fieldwise_init
struct View[origin: Origin](Copyable):
    var pointer: Pointer[Int32, Self.origin]
    def read(self) -> ref[Self.origin] Int32:
        return self.pointer[]
`;

export function boundedBorrowSource(mutable) {
  const reference = mutable ? "MutRef" : "Ref";
  const origin = mutable ? "MutOrigin" : "ImmOrigin";
  return `import { borrow } from "test:borrow";
import type { ${origin}, ${reference}, i32 } from "@tsonic/mojo/types.js";
export function relay<O extends ${origin}>(value: ${reference}<i32, O>): ${reference}<i32, O> {
  const alias: ${reference}<i32, O> = borrow<O>(value);
  return alias;
}`;
}

export function associatedProvider() {
  const self = { kind: "self", memberPath: [], arguments: [] };
  const item = { kind: "type-parameter", name: "T" };
  const parameter = { kind: "type", name: "T", passingKind: "positional", variadic: false, constraints: [] };
  const argument = (name, convention, type) => ({ name, convention, type, position: "positional", variadic: false });
  const method = (name, arguments_, result) => ({ identity: `native.Family.${name}`, name,
    genericParameters: [], arguments: arguments_, ...(result === undefined ? {} : { result }),
    static: false, raises: false, asynchronous: false, implicitConversion: false, requiredImplementation: false });
  const family = { kind: "struct", identity: "native.Family", name: "Family", genericParameters: [parameter],
    convention: "memory", parentTraits: [], fields: [], aliases: [{ identity: "native.Family.Element", name: "Element", category: "type",
      abstract: false, genericParameters: [], targetType: item, valueExpression: "T" }],
    functions: [method("__init__", [argument("self", "out", self), argument("value", "var", item)]),
      method("read", [argument("self", "imm", self)], { kind: "self", memberPath: ["Element"], arguments: [] })],
  };
  const package_ = { id: "native-associated", alias: "native-associated", packageName: "native_associated", version: "1", kind: "package", modules: [{ modulePath: [] }] };
  const module = { packageId: package_.id, packageVersion: package_.version, modulePath: [], moduleIdentity: "native-associated",
    availableExports: [{ name: "Family", kind: "struct" }], declarations: [family], functions: [] };
  const projection = projectMojoCompilerModule({ packages: [package_] }, package_, module, {
    providerModuleId: "test:associated", moduleSpecifier: "test:associated", exports: [{ declarationName: "Family", exportName: "Family" }],
  });
  return createMojoProviderPackage({ id: "@test/mojo-associated", displayName: "Native associated alias proof", version: "1",
    runtimePackages: [], modules: [projection.declarationModel], types: projection.types, operations: projection.operations });
}

export const associatedSource = `
import { Family } from "test:associated";
import type { int32 } from "@tsonic/core/types.js";
export function run(): int32 { const family = new Family<int32>(37); return family.read(); }
`;

export const associatedNative = `@fieldwise_init
struct Family[T: Copyable & Deinitable](Copyable):
    comptime Element = Self.T
    var value: Self.T
    def read(self) -> Self.Element:
        return self.value.copy()
`;
