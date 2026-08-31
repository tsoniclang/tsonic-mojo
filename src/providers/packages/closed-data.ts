const maximumNodes = 200_000;
const maximumDepth = 128;

export function snapshotClosedMetadata<T>(value: T): T {
  return cloneClosedMetadata(value, true);
}

export function materializeClosedMetadata<T>(value: T): T {
  return cloneClosedMetadata(value, false);
}

function cloneClosedMetadata<T>(value: T, freeze: boolean): T {
  const active = new Set<object>();
  let nodes = 0;

  const visit = (candidate: unknown, depth: number): unknown => {
    if (depth > maximumDepth) {
      throw new Error(`metadata exceeds the maximum depth of ${maximumDepth}`);
    }
    if (candidate === null || typeof candidate !== "object") {
      if (
        candidate === undefined ||
        typeof candidate === "string" ||
        typeof candidate === "number" && Number.isFinite(candidate) ||
        typeof candidate === "boolean"
      ) {
        return candidate;
      }
      throw new Error(`metadata contains unsupported '${typeof candidate}' data`);
    }
    nodes += 1;
    if (nodes > maximumNodes) {
      throw new Error(`metadata exceeds the maximum node count of ${maximumNodes}`);
    }
    if (active.has(candidate)) {
      throw new Error("metadata contains an object cycle");
    }
    active.add(candidate);
    let result: unknown;
    if (Array.isArray(candidate)) {
      const output = candidate.map((entry) => visit(entry, depth + 1));
      result = freeze ? Object.freeze(output) : output;
    } else {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error("metadata contains a non-plain object");
      }
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(candidate).sort((left, right) => left.localeCompare(right, "en"))) {
        output[key] = visit((candidate as Record<string, unknown>)[key], depth + 1);
      }
      result = freeze ? Object.freeze(output) : output;
    }
    active.delete(candidate);
    return result;
  };

  return visit(value, 0) as T;
}
