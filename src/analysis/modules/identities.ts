import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type { SourceFile } from "@tsonic/tsts";
import type { TargetCompileInput } from "@tsonic/target-api";
import { normalizeMojoIdentifier } from "../names/identifiers.js";
import type {
  MojoSourceModuleIssue,
  MojoSourcePackageDefinition,
} from "./model.js";

export interface MojoSourceModuleIdentity {
  readonly id: string;
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly relativeSourcePath: string;
  readonly packageId: string;
  readonly componentId: string;
  readonly packageName: string;
  readonly moduleSegments: readonly string[];
  readonly modulePath: readonly string[];
  readonly artifactPath: string;
  readonly entryPoint: boolean;
}

export interface MojoSourceModuleIdentityPlan {
  readonly identities: readonly MojoSourceModuleIdentity[];
  readonly packages: readonly MojoSourcePackageDefinition[];
  readonly entryPoint?: MojoSourceModuleIdentity;
  readonly issues: readonly MojoSourceModuleIssue[];
}

export function planMojoSourceModuleIdentities(
  input: TargetCompileInput,
  packageName: string,
  sourceFiles: readonly SourceFile[],
): MojoSourceModuleIdentityPlan {
  const issues: MojoSourceModuleIssue[] = [];
  const packageByFileName = sourcePackageByFileName(input);
  const rootPackage = input.sourcePackages.packages.find((entry) =>
    entry.id === input.sourcePackages.rootPackageId);
  if (rootPackage === undefined) {
    return Object.freeze({
      identities: Object.freeze([]),
      packages: Object.freeze([]),
      issues: Object.freeze([issue(
        "MOJO_ROOT_SOURCE_PACKAGE_MISSING",
        "The checked source-package graph has no root package entry.",
      )]),
    });
  }
  const componentPackageNames = allocateComponentPackageNames(
    input,
    rootPackage.componentId,
    packageName,
    issues,
  );
  const packageCountByComponent = new Map(input.sourcePackages.components.map((component) =>
    [component.id, component.packages.length] as const));
  const entryFileName = normalizePath(resolve(input.paths.projectRoot, input.project.entryPoint));
  const pending: {
    readonly sourceFile: SourceFile;
    readonly fileName: string;
    readonly relativeSourcePath: string;
    readonly sourceSegments: readonly string[];
    readonly packageId: string;
    readonly componentId: string;
    readonly packageName: string;
    readonly entryPoint: boolean;
  }[] = [];
  for (const sourceFile of sourceFiles) {
    const fileName = input.source.ast.getFileName(sourceFile);
    const normalizedFileName = normalizePath(resolve(fileName));
    const sourcePackage = packageByFileName.get(normalizedFileName);
    if (sourcePackage === undefined) {
      issues.push(issue(
        "MOJO_SOURCE_PACKAGE_IDENTITY_MISSING",
        `Source file '${fileName}' has no exact identity in the checked source-package graph.`,
        sourceFile,
      ));
      continue;
    }
    const relativeSourcePath = packageRelativeSourcePath(sourcePackage.sourceRoot, fileName);
    if (relativeSourcePath === undefined) {
      issues.push(issue(
        "MOJO_SOURCE_OUTSIDE_PACKAGE_ROOT",
        `Source file '${fileName}' is outside its exact source-package root '${sourcePackage.sourceRoot}'.`,
        sourceFile,
      ));
      continue;
    }
    const sourceSegments = sourceModuleSegments(relativeSourcePath);
    if (sourceSegments === undefined) {
      issues.push(issue(
        "MOJO_SOURCE_MODULE_IDENTITY_UNSUPPORTED",
        `Source file '${fileName}' has no deterministic Mojo module identity.`,
        sourceFile,
      ));
      continue;
    }
    const componentPackageName = componentPackageNames.get(sourcePackage.componentId);
    if (componentPackageName === undefined) {
      issues.push(issue(
        "MOJO_SOURCE_PACKAGE_COMPONENT_MISSING",
        `Source file '${fileName}' belongs to an unknown source-package component.`,
        sourceFile,
      ));
      continue;
    }
    const componentSegments = (packageCountByComponent.get(sourcePackage.componentId) ?? 0) > 1
      ? [normalizeMojoIdentifier(sourcePackage.name ?? "package"), ...sourceSegments]
      : sourceSegments;
    pending.push(Object.freeze({
      sourceFile,
      fileName,
      relativeSourcePath,
      sourceSegments: Object.freeze(componentSegments),
      packageId: sourcePackage.id,
      componentId: sourcePackage.componentId,
      packageName: componentPackageName,
      entryPoint: normalizedFileName === entryFileName,
    }));
  }

  const rootsByComponent = new Map<string, ModuleSegmentNode>();
  for (const source of pending) {
    const root = rootsByComponent.get(source.componentId) ?? createModuleSegmentNode();
    rootsByComponent.set(source.componentId, root);
    let node = root;
    for (const segment of source.sourceSegments) {
      const child = node.children.get(segment) ?? createModuleSegmentNode();
      node.children.set(segment, child);
      node = child;
    }
    node.terminal = true;
  }
  for (const root of rootsByComponent.values()) assignMojoModuleSegmentNames(root);

  const identities: MojoSourceModuleIdentity[] = [];
  const seenModulePaths = new Map<string, string>();
  const seenArtifactPaths = new Map<string, string>();
  for (const source of pending) {
    const root = rootsByComponent.get(source.componentId)!;
    const moduleSegments = resolveMojoModuleSegments(root, source.sourceSegments);
    const modulePath = Object.freeze([source.packageName, ...moduleSegments]);
    const artifactPath = `src/${modulePath.join("/")}.mojo`;
    const moduleIdentity = modulePath.join(".");
    const moduleOwner = seenModulePaths.get(moduleIdentity);
    const artifactOwner = seenArtifactPaths.get(artifactPath);
    if (moduleOwner !== undefined || artifactOwner !== undefined) {
      issues.push(issue(
        moduleOwner !== undefined
          ? "MOJO_SOURCE_MODULE_IDENTITY_COLLISION"
          : "MOJO_SOURCE_ARTIFACT_IDENTITY_COLLISION",
        `Source files '${source.fileName}' and '${moduleOwner ?? artifactOwner}' map to the same Mojo output identity.`,
        source.sourceFile,
      ));
      continue;
    }
    seenModulePaths.set(moduleIdentity, source.fileName);
    seenArtifactPaths.set(artifactPath, source.fileName);
    identities.push(Object.freeze({
      id: `mojo-source-module:${source.componentId}:${moduleSegments.join("/")}`,
      sourceFile: source.sourceFile,
      fileName: source.fileName,
      relativeSourcePath: source.relativeSourcePath,
      packageId: source.packageId,
      componentId: source.componentId,
      packageName: source.packageName,
      moduleSegments: Object.freeze(moduleSegments),
      modulePath,
      artifactPath,
      entryPoint: source.entryPoint,
    }));
  }
  const entries = identities.filter((identity) => identity.entryPoint);
  if (entries.length !== 1) {
    issues.push(issue(
      "MOJO_ENTRY_SOURCE_IDENTITY_MISSING",
      `Configured entry point '${input.project.entryPoint}' resolves to ${entries.length} checked Mojo source modules.`,
    ));
  }
  const packages = input.sourcePackages.components.flatMap((component) => {
    const componentPackageName = componentPackageNames.get(component.id);
    if (componentPackageName === undefined) return [];
    const directories = new Map<string, readonly string[]>();
    directories.set(componentPackageName, Object.freeze([componentPackageName]));
    for (const identity of identities.filter((entry) => entry.componentId === component.id)) {
      for (let length = 1; length < identity.modulePath.length; length += 1) {
        const path = Object.freeze(identity.modulePath.slice(0, length));
        directories.set(path.join("/"), path);
      }
    }
    return [Object.freeze({
      componentId: component.id,
      packageName: componentPackageName,
      root: component.id === rootPackage.componentId,
      moduleDirectories: Object.freeze([...directories.values()].sort(comparePaths)),
    })];
  });
  return Object.freeze({
    identities: Object.freeze(identities.sort((left, right) =>
      left.artifactPath.localeCompare(right.artifactPath, "en"))),
    packages: Object.freeze(packages.sort((left, right) =>
      left.packageName.localeCompare(right.packageName, "en"))),
    ...(entries.length === 1 ? { entryPoint: entries[0] } : {}),
    issues: Object.freeze(issues),
  });
}

function allocateComponentPackageNames(
  input: TargetCompileInput,
  rootComponentId: string,
  rootPackageName: string,
  issues: MojoSourceModuleIssue[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const component of input.sourcePackages.components) {
    const candidate = component.id === rootComponentId
      ? rootPackageName
      : `tsonic_dep_${shortHash(component.id)}`;
    const previous = owners.get(candidate);
    if (previous !== undefined && previous !== component.id) {
      issues.push(issue(
        "MOJO_SOURCE_PACKAGE_NAME_COLLISION",
        `Source-package components '${previous}' and '${component.id}' map to Mojo package '${candidate}'.`,
      ));
      continue;
    }
    owners.set(candidate, component.id);
    result.set(component.id, candidate);
  }
  return result;
}

function sourcePackageByFileName(
  input: TargetCompileInput,
): ReadonlyMap<string, TargetCompileInput["sourcePackages"]["packages"][number]> {
  const result = new Map<string, TargetCompileInput["sourcePackages"]["packages"][number]>();
  for (const sourcePackage of input.sourcePackages.packages) {
    for (const sourceFile of sourcePackage.sourceFiles) {
      result.set(normalizePath(resolve(sourceFile)), sourcePackage);
    }
  }
  return result;
}

function packageRelativeSourcePath(sourceRootValue: string, fileName: string): string | undefined {
  const sourceRoot = resolve(sourceRootValue);
  const relativeName = normalizePath(relative(sourceRoot, resolve(fileName)));
  return relativeName.length !== 0 && relativeName !== "." && relativeName !== ".." &&
      !relativeName.startsWith("../") && !isAbsolute(relativeName)
    ? relativeName
    : undefined;
}

function sourceModuleSegments(relativeSourcePath: string): readonly string[] | undefined {
  const sourcePath = relativeSourcePath.replace(/\.(?:mts|ts)$/u, "");
  if (sourcePath === relativeSourcePath || sourcePath.length === 0 ||
    sourcePath.startsWith("/") || sourcePath.endsWith("/")) return undefined;
  const segments = sourcePath.split("/");
  return segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ? undefined
    : Object.freeze(segments);
}

interface ModuleSegmentNode {
  readonly children: Map<string, ModuleSegmentNode>;
  terminal: boolean;
  directoryName?: string;
  moduleName?: string;
}

function createModuleSegmentNode(): ModuleSegmentNode {
  return { children: new Map(), terminal: false };
}

function assignMojoModuleSegmentNames(node: ModuleSegmentNode): void {
  const groups = new Map<string, {
    readonly sourceName: string;
    readonly node: ModuleSegmentNode;
    readonly role: "directory" | "module";
  }[]>();
  for (const [sourceName, child] of node.children) {
    const base = normalizeMojoIdentifier(sourceName);
    const group = groups.get(base) ?? [];
    if (child.children.size > 0) group.push({ sourceName, node: child, role: "directory" });
    if (child.terminal) group.push({ sourceName, node: child, role: "module" });
    groups.set(base, group);
  }
  const reserved = new Set(groups.keys());
  const used = new Set<string>();
  for (const [base, group] of [...groups].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    group.sort((left, right) =>
      left.sourceName.localeCompare(right.sourceName, "en") ||
      left.role.localeCompare(right.role, "en"));
    for (const [index, entry] of group.entries()) {
      let candidate = base;
      let suffix = 2;
      if (index > 0 || used.has(candidate)) {
        do {
          candidate = `${base}_${suffix}`;
          suffix += 1;
        } while (reserved.has(candidate) || used.has(candidate));
      }
      if (entry.role === "directory") entry.node.directoryName = candidate;
      else entry.node.moduleName = candidate;
      used.add(candidate);
    }
  }
  for (const child of node.children.values()) assignMojoModuleSegmentNames(child);
}

function resolveMojoModuleSegments(root: ModuleSegmentNode, sourceSegments: readonly string[]): string[] {
  const result: string[] = [];
  let node = root;
  for (const [index, sourceSegment] of sourceSegments.entries()) {
    node = node.children.get(sourceSegment)!;
    result.push(index + 1 === sourceSegments.length ? node.moduleName! : node.directoryName!);
  }
  return result;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizePath(value: string): string {
  return value.split("\\").join("/");
}

function comparePaths(left: readonly string[], right: readonly string[]): number {
  return left.join("/").localeCompare(right.join("/"), "en");
}

function issue(code: string, message: string, node?: SourceFile): MojoSourceModuleIssue {
  return Object.freeze({ code, message, ...(node === undefined ? {} : { node }) });
}
