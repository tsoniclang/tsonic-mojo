import {
  collectImportActivatedTargetCapabilities,
  collectRuntimeActivatedTargetCapabilities,
} from "../../../tsonic/packages/host/dist/target/capability-activation.js";
import {
  captureTargetCapabilityContributions,
  createTargetSourceCompilerComposition,
  getTargetRequiredProviderModules,
  selectInstalledTargetCapabilities,
  selectTargetSurfaceImplementations,
} from "../../../tsonic/packages/host/dist/target/extensions.js";
import { collectTargetRuntimeContributions } from "../../../tsonic/packages/host/dist/target/runtime-contributions.js";
import { collectTargetSourceProfileContributions } from "../../../tsonic/packages/host/dist/target/source-profile.js";
import { collectTargetSourcePackageGraph } from "../../../tsonic/packages/host/dist/source-package-inputs.js";
import {
  createCompilerSessionFromFiles,
  formatDiagnostics,
} from "@tsonic/tsts";
import {
  createTargetSourceProgram,
  sourceProjectFiles,
} from "@tsonic/target-api/source";
import { createMojoTargetPack } from "../../dist/index.js";

export function createMojoSession({
  files,
  target = { id: "mojo", options: {} },
  packages = [],
  capabilities = [],
  surfaces = [],
  entryPoint = "index.ts",
  sourcePackages,
  compilerOptions = {},
} = {}) {
  const pack = createMojoTargetPack();
  target = surfaces.length === 0 || target.surfaces !== undefined
    ? target
    : { ...target, surfaces };
  const project = { entryPoint, targets: [target] };
  const paths = Object.freeze({
    projectFilePath: "/src/tsonic.json",
    projectRoot: "/src",
    outputRoot: "/src/out",
    targetOutputRoot: "/src/out/mojo",
  });
  const candidates = [...packages, ...capabilities];
  const activation = collectCapabilityActivation(files, candidates, target);
  const surfaceSelection = selectTargetSurfaceImplementations(pack, target);
  if ("error" in surfaceSelection) throw new Error(surfaceSelection.error);
  const capabilitySelection = selectInstalledTargetCapabilities(
    target,
    activation.selected,
    surfaceSelection.selectedSurfaces,
  );
  if ("error" in capabilitySelection) throw new Error(capabilitySelection.error);
  const selectedSurfaces = surfaceSelection.selectedSurfaces;
  const selectedCapabilities = capabilitySelection.selectedCapabilities;
  const capturedCapabilities = captureTargetCapabilityContributions({
    project,
    projectDirectory: "/src",
    target,
    selectedCapabilities,
    selectedSurfaces,
  });
  const targetSession = pack.createCompilationSession(Object.freeze({
    project,
    projectDirectory: "/src",
    target,
    paths,
    selectedSurfaceIds: Object.freeze(selectedSurfaces.map((surface) => surface.id)),
    capabilities: capturedCapabilities,
  }));
  const sourceProfile = collectTargetSourceProfileContributions({
    project,
    projectRoot: "/src",
    projectDirectory: "/src",
    target,
    targetPackId: pack.id,
    selectedCapabilities,
    selectedSurfaces,
    targetContributions: targetSession.sourceProfileContributions(),
  });
  if (sourceProfile.diagnostics.length !== 0) {
    targetSession.close();
    throw new Error(sourceProfile.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  const projectFiles = new Map(
    Object.entries(files).map(([name, text]) => [`/src/${name}`, text]),
  );
  sourcePackages ??= withFixtureEntryExport(
    collectTargetSourcePackageGraph("/src", "/src", projectFiles),
    projectFiles,
    entryPoint,
  );
  const fileMap = new Map([
    ...projectFiles,
    ...sourceProfile.files.map((file) => [file.path, file.text]),
  ]);
  const composition = createTargetSourceCompilerComposition({
    project,
    projectDirectory: "/src",
    target,
    targetPack: pack,
    selectedCapabilities,
    selectedSurfaces,
    targetContributions: targetSession.sourceCompilerContributions(),
  });
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: fileMap,
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      noLib: true,
      strictNullChecks: true,
      target: "es2022",
      ...compilerOptions,
    },
    extensionHostOptions: {
      extensions: composition.extensions,
      requiredProviderModules: getTargetRequiredProviderModules(
        target,
        pack.provider,
        selectedCapabilities,
      ),
    },
  });
  return {
    session,
    targetSession,
    pack,
    project,
    target,
    selectedSurfaces,
    selectedCapabilities,
    paths,
    sourcePackages,
    runtimeActivatedCapabilities: selectedCapabilities.filter((capability) =>
      activation.runtimeIds.has(capability.id)),
  };
}

export function compileMojo(options) {
  const harness = createMojoSession(options);
  try {
    const source = harness.session.checkSource();
    const diagnostics = sourceDiagnostics(source);
    if (diagnostics !== "") throw new Error(`TypeScript diagnostics:\n${diagnostics}`);
    const extensionDiagnostics = source.extensionDiagnostics
      .filter((diagnostic) => diagnostic.category === "error")
      .map(projectDiagnostic);
    if (extensionDiagnostics.length !== 0) {
      return Object.freeze({
        artifacts: Object.freeze([]),
        diagnostics: Object.freeze(extensionDiagnostics),
      });
    }
    const runtime = collectTargetRuntimeContributions({
      project: harness.project,
      projectDirectory: "/src",
      target: harness.target,
      targetPackId: harness.pack.id,
      selectedCapabilities: harness.selectedCapabilities,
      runtimeActivatedCapabilities: harness.runtimeActivatedCapabilities,
      selectedSurfaces: harness.selectedSurfaces,
      paths: harness.paths,
      targetContributions: harness.targetSession.runtimeContributions(),
    });
    if (runtime.diagnostics.length !== 0) {
      return Object.freeze({ artifacts: Object.freeze([]), diagnostics: runtime.diagnostics });
    }
    const compiled = harness.targetSession.compile(Object.freeze({
      source: createTargetSourceProgram(source),
      sourcePackages: harness.sourcePackages,
      project: harness.project,
      target: harness.target,
      runtimeReferences: runtime.references,
      paths: harness.paths,
    }));
    return Object.freeze({
      artifacts: compiled.kind === "resolved" ? compiled.value.artifacts : Object.freeze([]),
      diagnostics: Object.freeze(compiled.diagnostics.map(projectDiagnostic)),
    });
  } finally {
    harness.targetSession.close();
  }
}

function projectDiagnostic(diagnostic) {
  return Object.freeze({
    code: diagnostic.code ?? diagnostic.extensionCode,
    category: diagnostic.category,
    source: diagnostic.source ?? diagnostic.extensionId,
    message: diagnostic.message,
    evidence: Object.freeze((diagnostic.evidence ?? []).map((entry) =>
      typeof entry === "string" ? entry : entry.message)),
  });
}

export function artifactTexts(result, language = "mojo") {
  return result.artifacts
    .filter((artifact) => artifact.kind === "source" && artifact.language === language)
    .map((artifact) => Object.freeze({ path: artifact.path, text: artifact.text }));
}

function sourceDiagnostics(source) {
  const compiler = formatDiagnostics(source.diagnostics);
  const extensions = source.extensionDiagnostics
    .map((diagnostic) => `TSEXT${diagnostic.numericCode}: ${diagnostic.message}`)
    .join("\n");
  return [compiler, extensions].filter((entry) => entry !== "").join("\n");
}

function withFixtureEntryExport(sourcePackages, projectFiles, entryPoint) {
  const entryFile = entryPoint.startsWith("/")
    ? entryPoint
    : `/src/${entryPoint.replace(/^\.\//u, "")}`;
  if (!projectFiles.has(entryFile)) return sourcePackages;
  return Object.freeze({
    ...sourcePackages,
    fingerprint: `${sourcePackages.fingerprint}:fixture-entry:${entryFile}`,
    packages: Object.freeze(sourcePackages.packages.map((sourcePackage) =>
      sourcePackage.id !== sourcePackages.rootPackageId
        ? sourcePackage
        : Object.freeze({
            ...sourcePackage,
            exports: Object.freeze([{ specifier: ".", sourceFile: entryFile }]),
          }))),
  });
}

function collectCapabilityActivation(files, candidates, target) {
  if (candidates.length === 0) return { selected: [], runtimeIds: new Set() };
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: new Map(Object.entries(files).map(([name, text]) => [`/src/${name}`, text])),
    compilerOptions: { module: "esnext", moduleResolution: "bundler", noLib: true, target: "es2022" },
  });
  const source = session.checkSource();
  const projectSourceFiles = sourceProjectFiles(source);
  const selected = collectImportActivatedTargetCapabilities(
    source.ast,
    projectSourceFiles,
    candidates,
    target,
  );
  const runtimeIds = new Set(collectRuntimeActivatedTargetCapabilities(
    source.ast,
    projectSourceFiles,
    selected,
  ).map((capability) => capability.id));
  return { selected, runtimeIds };
}
