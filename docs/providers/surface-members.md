# Surface-scoped provider members

A provider may add members to an existing class or interface when specified
source surfaces are selected. Declarations and target relations travel in one
`surfaceMembers` slice. Base module ownership and runtime packages do not change.

For example, Node filesystem numeric timestamps are available in the native
profile, but Date-valued timestamps require the JS profile:

```ts
import { statSync } from "node:fs";

const metadata = statSync("page.md");
metadata.mtimeMs;
metadata.mtime.getTime();
```

The last expression requires `surfaces: ["js"]`. It does not implicitly activate
JS globals for other programs.

Each `MojoProviderSurfaceMembers` slice has a stable `id`, nonempty distinct
`requiredSurfaces`, exact `declarations: { exportId, members }[]`, and exact
`operations`. Every required surface must be selected. A slice may not replace a
base member, duplicate another member/signature, contribute an operation for a
different slice, or refer to a missing class/interface. Invalid compositions fail
when the provider package is created, including conflicts between slices.

`createMojoProviderPackage` snapshots input metadata and uses the same immutable
selection function for source declarations and target policy contributions.
Each host context supplies `selectedSurfaceIds`; no checker query or module-name
heuristic participates in selection. Unselected members are absent from both
boundaries. A subsequent native compilation cannot retain an earlier JS
compilation's members.
