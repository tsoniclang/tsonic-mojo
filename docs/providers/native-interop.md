# Exact native interop

Compiler-backed imports retain native type, origin, convention and selected
signature identities. Source code uses ordinary calls; the provider, not call
spelling, identifies the operation.

## Borrowed results

```ts
import { borrow } from "@tsonic/mojo/packages/borrow/index.js";
import type { Origin, Ref, i32 } from "@tsonic/mojo/types.js";

export function relay<O extends Origin>(value: Ref<i32, O>): Ref<i32, O> {
  const alias: Ref<i32, O> = borrow<O>(value);
  return alias;
}
```

For a native declaration `borrow[origin: Origin](ref[origin] value: Int32)
-> ref[origin] Int32`, the imported source result remains a `Ref`, not an owned
integer. Generated locals use `ref alias_: Int32`; native origin checking rejects
an escaping local borrow. Origin-bearing receiver arguments participate in the
same exact type/value/origin substitution. No reference becomes a heap owner.

`StaticOrigin`, `InferredOrigin`, `UntrackedOrigin` and
`UnsafeOrigin` have distinct meanings. Inference requests native elision; it is
not permission to manufacture a static or unchecked origin.
Static origins emit the native `ImmStaticOrigin` constant through an exact
symbol import. Compiler-produced reference qualifiers are checked against the
same overload's structured arguments before entering the provider model.

## Associated aliases

A compiler-defined `Family[T].Element = T` gives `Family[i32].read()` an `i32`
source result and an `Int32` native result. The provider resolves the exact alias
definition and owner arguments. It requests only the declaration needed for that
selection, including across configured package modules. Cycles, missing aliases,
unclosed argument packs and abstract projections reject; they never become
`object`. Abstract associated projections require a source declaration contract
that can express the selected type relation, not a fabricated instance field.

## Foreign C calls

A provider can declare a `foreign-call` operation with an exact C `symbol`,
`fixedParameterCount`, and `arguments`, alongside its exact source signature and
native `parameterTypes`/`resultType`. This is a C ABI declaration, not automatic
C-header discovery.

```ts
import { probe } from "native-library";
import { unsafeContext } from "@tsonic/core/lang.js";
import type { float32, int8, uint64 } from "@tsonic/core/types.js";

export function call(small: int8, value: float32, exact: uint64): number {
  unsafeContext();
  return probe(3, small, value, exact);
}
```

For a declared one-fixed-argument C variadic function, lowering calls
`external_call["probe", Float64, num_fixed_args=1]` once. Narrow integer values
promote to C `int`; `float32` promotes to `double`; full-width integers and native
pointers retain their carriers. Fixed parameters use their declared ABI. Source
evaluation order is retained, and a closed tuple spread expands by selected slots.
Open sequence spreads, strings, objects and implicit pointer conversions reject.

A non-variadic signature omits `num_fixed_args`. A variadic signature with zero
fixed arguments passes `num_fixed_args=0`; those are not interchangeable ABIs.

Run `npm run test:native-interop` for generated-source C calls, reference address
identity, concrete associated results, and a native borrow-escape rejection.
