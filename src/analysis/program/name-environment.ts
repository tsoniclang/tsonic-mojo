import type { SourceFile } from "@tsonic/tsts";
import { createMojoNameAllocator } from "../names/allocator.js";
import {
  normalizeMojoConstantIdentifier,
  normalizeMojoIdentifier,
  normalizeMojoPackageDeclarationIdentifier,
  normalizeMojoTypeIdentifier,
} from "../../target-model/names/identifiers.js";

export type MojoNameRole = "value" | "type" | "constant";

export interface MojoProgramNameEnvironment {
  readonly reservedNames: Set<string>;
  readonly createNameAllocator: (role?: MojoNameRole) => (name: string) => string;
  readonly globalNames: (sourceFile: SourceFile) => (name: string, role?: MojoNameRole) => string;
  readonly unownedGlobalNames: (name: string, role?: MojoNameRole) => string;
}

export function createMojoProgramNameEnvironment(): MojoProgramNameEnvironment {
  const reservedNames = new Set<string>();
  const normalizer = (role: MojoNameRole): ((name: string) => string) =>
    role === "type"
      ? normalizeMojoTypeIdentifier
      : role === "constant"
        ? normalizeMojoConstantIdentifier
        : normalizeMojoIdentifier;
  const createNameAllocator = (role: MojoNameRole = "value"): ((name: string) => string) =>
    createMojoNameAllocator([], (name) => reservedNames.add(name), normalizer(role));
  const createGlobalNameAllocator = (): ((name: string, role?: MojoNameRole) => string) => {
    const used = new Set<string>();
    return (name, role = "value") => {
      const normalized = role === "value"
        ? normalizeMojoPackageDeclarationIdentifier(name)
        : normalizer(role)(name);
      let candidate = normalized;
      let suffix = 2;
      while (used.has(candidate)) candidate = `${normalized}_${suffix++}`;
      used.add(candidate);
      reservedNames.add(candidate);
      return candidate;
    };
  };
  const globalNamesBySourceFile = new WeakMap<SourceFile, (
    name: string,
    role?: MojoNameRole,
  ) => string>();
  const globalNames = (sourceFile: SourceFile): ((name: string, role?: MojoNameRole) => string) => {
    const existing = globalNamesBySourceFile.get(sourceFile);
    if (existing !== undefined) return existing;
    const created = createGlobalNameAllocator();
    globalNamesBySourceFile.set(sourceFile, created);
    return created;
  };
  return Object.freeze({
    reservedNames,
    createNameAllocator,
    globalNames,
    unownedGlobalNames: createGlobalNameAllocator(),
  });
}
