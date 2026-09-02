import { normalizeMojoIdentifier } from "../../target-model/names/identifiers.js";

export function createMojoNameAllocator(
  initiallyUsed: Iterable<string> = [],
  onAllocate?: (name: string) => void,
  normalize: (sourceName: string) => string = normalizeMojoIdentifier,
): (sourceName: string) => string {
  const used = new Set(initiallyUsed);
  return (sourceName: string): string => {
    const normalized = normalize(sourceName);
    let candidate = normalized;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${normalized}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    onAllocate?.(candidate);
    return candidate;
  };
}
