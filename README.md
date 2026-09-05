# `@tsonic/target-mojo`

The Mojo target pack for Tsonic. It consumes finalized TSTS source semantics,
seals a target-owned Mojo program, plans typed Mojo syntax, and materializes a
deterministic Pixi/Mojo source project.

The supported compiler is pinned to Mojo `1.1.0.dev2026083005`. Native Mojo is
the default source profile; JavaScript semantics are enabled only by selecting
the `js` surface, and Node APIs are supplied independently by
`@tsonic/mojo-nodejs`.

The current foundation provides one complete vertical slice:

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

Source `number` bitwise operators (`~`, `&`, `|`, `^`, `<<`, `>>`, `>>>`)
and compound assignments retain 32-bit TypeScript numeric semantics on both
profiles. Explicit integral carriers use native operations. Compound writes
evaluate the location, read its value, evaluate the right operand, then write.

Raw-pointer equality and hashing consume supplied addresses. Native-pointer
load, store and element offsets require an explicit `unsafeContext`. The retired
object-binding marker is not supported. Layout-backed raw-memory conversions
(`toRawPointer` and `reinterpretRawPointer`) are not implemented: a source layout
fact alone does not prove native storage layout or ownership.

The pinned Mojo compiler has a reproduced runtime defect when forwarding a
borrowed `String` to a non-inlined variadic function. It reproduces in a small
standard-library-only program and affects Tsumo's array-call execution. Full
Tsumo runtime acceptance is therefore not certified on this compiler pin;
successful native compilation alone is not an execution proof.
