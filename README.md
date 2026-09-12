# `@tsonic/target-mojo`

The Mojo target pack for Tsonic. It consumes finalized TSTS source semantics,
seals a target-owned Mojo program, plans typed Mojo syntax, and materializes a
deterministic Pixi/Mojo source project.

Generation requires the pinned Mojo compiler. The pure AST printer produces
source, then artifact materialization runs `mojo format` in bounded batches in
a private staging directory. Only a completely formatted output set is returned
for atomic publication; formatter/version failures produce
`MOJO_SOURCE_FORMATTING_FAILED`, never unformatted fallback output. Non-Mojo
artifacts remain unchanged. Imported native package sources are adopted
byte-for-byte, not regenerated; their owners maintain their canonical formatting.

By default `mojo` must be on PATH. The existing `options.compiler` command may
instead select an explicit executable, arguments and working directory (for
example a project's locked Pixi wrapper). This same command supplies native
provider queries and formatting. Run the test suite in that pinned SDK
environment, for example `pixi run --manifest-path ../mojo-runtime/pixi.toml npm test`.

The supported compiler is pinned to Mojo `1.1.0.dev2026083005`. Native Mojo is
the default source profile; JavaScript semantics are enabled only by selecting
the `js` surface, and Node APIs are supplied independently by
`@tsonic/mojo-nodejs`.

The target preserves these compilation boundaries:

- an ordered compilation session and deterministic generated/user-owned
  project modes;
- immutable provider packages joining virtual TypeScript declarations to
  exact Mojo call ABIs and runtime package paths;
- analysis that seals names, types, selected calls, effects, and runtime
  requirements before planning;
- typed Mojo syntax and a dedicated printer;
- native scalar functions, initialized locals, returns, assignments,
  conditionals, loops, project calls, and provider calls;
- explicit native and JavaScript string carriers; and
- pinned Pixi projects for Mojo libraries and executables.

Unsupported syntax or missing/ambiguous semantic evidence rejects before
materialization. The planner has syntax traversal and sealed target queries,
but no checker, source-fact writer, provider callback, or semantic fallback.

Provider rest parameters may explicitly declare `restPacking: "list"` on their
final immutable target argument. `parameterTypes` supplies the exact element
carrier; the native parameter receives one `List` of those elements, not native
variadic arguments. For example, `values.push(first(), second())` emits one
`values.push(values=[first(), second()])` call. Spread inputs are consumed in
source order before evaluating the following argument. The runtime, not the
compiler, defines the operation over that collection. Owned JS and Node runtime
entrypoints use this contract; imported native variadic APIs keep their declared
ABI. The collection can require temporary allocation; this is not a claim that
native variadic compilation is fixed.

Source `number` bitwise operators (`~`, `&`, `|`, `^`, `<<`, `>>`, `>>>`)
and compound assignments retain 32-bit TypeScript numeric semantics on both
profiles. Explicit integral carriers use native operations. Compound writes
evaluate the location, read its value, evaluate the right operand, then write.

Raw-pointer equality and hashing consume supplied addresses. Native-pointer
load, store and element offsets require an explicit `unsafeContext`.
Typed locations retain their physical allocation or exact accessor owner;
binding and projection preserve identity without manufacturing a native address.
Layout-backed views validate ABI, alignment and bounds and retain a supplied
allocation owner. Scalar and fixed-array layouts must match native storage;
provider records additionally require complete exact field relations and native
compile-time field/type/offset checks. An opaque managed object is not a native
record. Integer-derived raw addresses remain an explicit unsafe caller obligation.

`const alias = values; addressOf(alias[index])` uses retained native array storage
only when shared source analysis closes the entire local allocation/alias/use
graph without unproved resizing or escape. Reassigning `values` does not retarget
an existing element pointer. JS arrays retain their separate growable-array
contract. `npm run test:native-memory` exercises generated scalar and native-record
views under Linux systemd memory, swap, process and time limits.

The native-record integration proof executes generated field-offset composition
against exact provider-selected native fields and verifies writes through the
original allocation. Shared layout queries supply their finalized integer
evidence; stabilized pointer operands retain their selected native copy contract.
Retained native async callbacks now own each invocation's arguments and retain
their original captured environment. Native execution proves escaped factories,
shared captured state, move-only argument cleanup, defaults and rest arguments.
`npm run test:native-async` also keeps the remaining positive native acceptance
tests enabled: nested raising-coroutine lowering remains blocked in the pinned
compiler, and its await ABI cannot preserve non-native typed error payloads.
Those payloads reject before artifact publication instead of being silently
reinterpreted as native `Error`. JS promise scheduling is not substituted with a
native scheduler. No erased origin or generated state machine is used.

The pinned Mojo compiler has a reproduced runtime defect when forwarding a
borrowed `String` to a non-inlined variadic function. It reproduces in a small
standard-library-only program. Owned collection APIs use the explicit list ABI
described above, so that defect no longer governs Tsumo's collection calls.
Imported native variadic APIs retain their native contract; the upstream defect
is not claimed fixed. Pudding and Tsumo require native execution proofs, not just
successful generation or compilation.

Array joining and default sorting use source value coercions, including decimal
number spelling, lowercase booleans and UTF-16 ordering. `Array.from` creates a
new collection; array `for...of` reads the live collection in source order.
Sparse reads cannot silently disappear or manufacture a value incompatible with
the selected element carrier.

Native runtime package manifests declare C11, C++17 or C++20 translation units explicitly.
The schema-4 native build manifest retains each unit's language and standard and
selects compiler paths inside the pinned Pixi environment. The common runtime
uses a bounded C ABI to the C++ standard library's shortest-round-trip numeric
conversion; source decimal/exponent formatting remains common runtime policy.
Headers and other required native text assets are captured and published
explicitly. [Native package contracts](docs/providers/native-runtime-packages.md)
separate package-source include paths from environment include paths.

The target follows the same twelve top-level layers as C# and Rust. This is not
a claim of complete behavioral parity: generators, native asynchronous iterator
protocols and some provider contracts remain unsupported. The retained parity
inventory is a lane/proof index, not a complete enumeration of all Node exports,
members or overloads.
