#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TSONIC_ROOT="$(cd "$REPO_ROOT/../tsonic" && pwd -P)"

required_dist_outputs=(
  "packages/source-core/dist/public/index.d.ts"
  "packages/js-source-profile/dist/index.d.ts"
  "packages/target-api/dist/public/index.d.ts"
  "packages/target-api/dist/public/artifacts.d.ts"
  "packages/target-api/dist/public/provider.d.ts"
  "packages/target-api/dist/public/source.d.ts"
  "packages/tsts/dist/src/index.d.ts"
)

for output in "${required_dist_outputs[@]}"; do
  if [[ ! -f "$TSONIC_ROOT/$output" ]]; then
    printf 'Missing prebuilt Tsonic output: %s\n' "$TSONIC_ROOT/$output" >&2
    exit 1
  fi
done

node "$REPO_ROOT/scripts/clean-dist.mjs"
"$TSONIC_ROOT/scripts/build/tsgo-project.sh" "$REPO_ROOT/tsconfig.json" --pretty false
