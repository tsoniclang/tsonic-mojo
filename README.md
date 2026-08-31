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
