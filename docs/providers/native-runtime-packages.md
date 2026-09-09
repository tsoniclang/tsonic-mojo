# Native runtime packages

A runtime package declares native inputs in `<package>.runtime.json` beside its
Mojo import root. The target captures these inputs once during analysis and
publishes them beneath `packages/.native/<package>/`. Planning and printing do
not rescan headers or depend on the original installation's file paths.

```json
{
  "contractVersion": 1,
  "dependencies": { "c-compiler": "==2.0.0" },
  "translationUnits": [
    { "language": "c", "standard": "c11", "path": "native/bridge.c" }
  ],
  "assets": ["native/include/bridge.h", "native/LICENSE"],
  "sourceIncludeDirectories": ["native/include"],
  "includeDirectories": ["include/external-library"],
  "dynamicLibraries": ["pthread"]
}
```

- `translationUnits` are explicit C11, C++17 or C++20 compilation inputs.
- `assets` are explicit UTF-8 headers, licenses or other required text files.
  Their bytes, including BOM and line endings, are preserved. No inferred include
  closure or directory-copy fallback exists.
- `sourceIncludeDirectories` resolve beneath the published native package.
  Every directory must contain at least one published input.
- `includeDirectories` and `staticLibraries` resolve inside `CONDA_PREFIX`.
  Dynamic library names are explicitly provided; a C++ unit does not implicitly
  select a C++ ABI library on the provider's behalf.
- Paths are relative without traversal or symlink components. Captures are
  bounded to 64 translation units, 256 assets and 64 MiB combined text, with a
  separate 1 MiB manifest limit. Missing or changing inputs reject publication.

Package digests include all input digests, dialects, include paths, dependencies
and libraries. Native object identities include the package digest, so changing
a header invalidates every object in its package. This is conservative package
invalidation, not a guessed C/C++ dependency graph.

`mojo-native-build.json` schema 4 exposes environment-relative
`includeDirectories` separately from project-relative `sourceIncludeDirectories`.
Generated Pixi and user-owned project builders consume the same sealed contract.
Old schema readers must be updated rather than silently ignoring source inputs.
