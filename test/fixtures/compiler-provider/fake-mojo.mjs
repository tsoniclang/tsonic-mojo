import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("Mojo 1.1.0.dev2026083005 (fixture)\n");
  process.exit(0);
}

if (args[0] !== "doc") {
  process.stderr.write(`unsupported fake Mojo command: ${args.join(" ")}\n`);
  process.exit(2);
}

if (process.env.TSONIC_MOJO_PROVIDER_EXPECT_ENV !== undefined &&
  process.env.TSONIC_MOJO_PROVIDER_ENV !== process.env.TSONIC_MOJO_PROVIDER_EXPECT_ENV) {
  process.stderr.write("compiler environment changed after snapshot\n");
  process.exit(3);
}
if (process.env.TSONIC_MOJO_PROVIDER_LOG !== undefined) {
  appendFileSync(process.env.TSONIC_MOJO_PROVIDER_LOG, "doc\n");
}

const outputIndex = args.indexOf("-o");
if (outputIndex < 0 || args[outputIndex + 1] === undefined) {
  process.stderr.write("missing metadata output path\n");
  process.exit(2);
}

const inputPath = args[1];
const inputSource = statSync(inputPath).isFile() ? readFileSync(inputPath, "utf8") : "";
const aliasProbe = /__tsonic_classify_alias_(type|origin|value)_/u.exec(inputSource);
const probeCategory = aliasProbe?.[1] ?? /__tsonic_classify_(type|origin|value)_/u.exec(inputSource)?.[1] ??
  basename(inputPath, ".mojo");
if (probeCategory === "type" || probeCategory === "origin" || probeCategory === "value") {
  const subject = aliasProbe === null
    ? /__TsonicCandidate:\s*([^\]\n]+)/u.exec(inputSource)?.[1]?.trim()
    : inputSource.slice(aliasProbe.index);
  const expected = subject?.includes("OriginAlias") === true
    ? "origin"
    : subject?.includes("ValueAlias") === true
      ? "value"
      : subject?.includes("TypeAlias") === true || subject?.includes("BrokenAlias") === true ||
          subject?.includes(".Element") === true || subject?.startsWith("def(") === true
        ? "type"
        : subject === "T"
          ? "value"
          : undefined;
  if (probeCategory !== expected) {
    process.stderr.write(`fixture rejects ${probeCategory} classification for ${subject ?? "unknown"}\n`);
    process.exit(1);
  }
  writeFileSync(args[outputIndex + 1], "{}");
  process.exit(0);
}

const typeValue = (type, path) => ({ type, ...(path === undefined ? {} : { path }) });
const argument = (name, convention, passingKind, type, path, defaultValue) => ({
  convention,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
  description: "",
  kind: "argument",
  name,
  passingKind,
  ...typeValue(type, path),
});
const overload = (name, args_, returns, extras = {}) => ({
  args: args_,
  async: false,
  constraints: "",
  deprecated: "",
  description: "",
  hasDefaultImplementation: false,
  isImplicitConversion: false,
  isStabilityTracked: false,
  isStable: false,
  isStatic: false,
  kind: "function",
  name,
  parameters: [],
  raises: false,
  raisesDoc: "",
  ...(returns === undefined ? {} : { returns }),
  signature: `def ${name}`,
  sinceVersion: "",
  summary: "",
  ...extras,
});
const group = (name, overloads) => ({ kind: "function", name, overloads });
const int32 = "/std/builtin/simd/#int32";

const trait = (name, extras = {}) => ({
  aliases: [],
  deprecated: "",
  description: "",
  fields: [],
  functions: [],
  isStabilityTracked: false,
  isStable: false,
  kind: "trait",
  name,
  parentTraits: [],
  sinceVersion: "",
  summary: "",
  ...extras,
});
const struct = (name, extras = {}) => ({
  aliases: [],
  constraints: "",
  convention: "memory_only",
  deprecated: "",
  description: "",
  fields: [],
  functions: [],
  isStabilityTracked: false,
  isStable: false,
  kind: "struct",
  name,
  parameters: [],
  parentTraits: [],
  signature: `struct ${name}`,
  sinceVersion: "",
  summary: "",
  ...extras,
});
const alias = (name, type, value, path) => ({
  deprecated: "",
  description: "",
  isStabilityTracked: false,
  isStable: false,
  kind: "alias",
  name,
  parameters: [],
  path,
  signature: `comptime ${name}`,
  sinceVersion: "",
  summary: "",
  type,
  value,
});

const apiModule = {
    aliases: process.env.TSONIC_MOJO_PROVIDER_BROKEN_EXPORT === undefined
      ? []
      : [alias("BrokenAlias", "AnyType", "External[Unclassified", "/probe/api/BrokenAlias")],
    description: "",
    functions: [
      group("sum", [overload("sum", [
        argument("left", "imm", "pos_or_kw", "Int32", int32),
        argument("right", "imm", "kw", "Int32", int32, "Int32(0)"),
      ], typeValue("Int32", int32))]),
      group("collect", [overload("collect", [], typeValue("Int32", int32), {
        parameters: [
          {
            description: "",
            kind: "parameter",
            name: "*Ts",
            passingKind: "pos_or_kw",
            traits: [
              typeValue("Sequence", "/probe/traits/Sequence"),
              typeValue("Copyable", "/probe/traits/Copyable"),
            ],
            type: "Sequence & Copyable",
          },
          {
            description: "",
            kind: "parameter",
            name: "flag",
            passingKind: "kw",
            ...typeValue("Flag", "/probe/traits/Flag"),
          },
        ],
      })]),
      group("classify", [overload("classify", [], typeValue("Int32", int32), {
        parameters: [
          {
            description: "",
            kind: "parameter",
            name: "T",
            passingKind: "pos",
            ...typeValue("TypeAlias", "/probe/_private/TypeAlias"),
          },
          {
            description: "",
            kind: "parameter",
            name: "origin",
            passingKind: "inferred",
            ...typeValue("OriginAlias", "/probe/_private/OriginAlias"),
          },
          {
            default: "Int(4)",
            description: "",
            kind: "parameter",
            name: "size",
            passingKind: "kw",
            ...typeValue("ValueAlias", "/probe/_private/ValueAlias"),
          },
          {
            description: "",
            kind: "parameter",
            name: "payload",
            passingKind: "pos_or_kw",
            type: "T",
          },
        ],
      })]),
    ],
    kind: "module",
    name: "api",
    structs: [{
      aliases: [],
      constraints: "",
      convention: "memory_only",
      deprecated: "",
      description: "",
      fields: [
        { description: "", kind: "field", name: "value", summary: "", type: "Int32" },
        {
          description: "",
          kind: "field",
          name: "bucket",
          path: "/probe/api/Bucket",
          summary: "",
          type: "Bucket[Int32]",
        },
      ],
      functions: [
        group("__init__", [overload("__init__", [
          argument("value", "imm", "pos_or_kw", "Int32", int32),
          argument("self", "out", "pos_or_kw", "Self"),
        ], typeValue("Self"))]),
        group("increment", [overload("increment", [
          argument("self", "mut", "pos_or_kw", "Self"),
          argument("amount", "imm", "pos_or_kw", "Int32", int32),
        ], typeValue("Int32", int32))]),
        group("__getitem__", [overload("__getitem__", [
          argument("self", "ref", "pos_or_kw", "Self"),
          argument("index", "imm", "pos_or_kw", "Int32", int32),
        ], typeValue("Int32", int32))]),
        group("__setitem__", [overload("__setitem__", [
          argument("self", "mut", "pos_or_kw", "Self"),
          argument("index", "imm", "pos_or_kw", "Int32", int32),
          argument("value", "imm", "pos_or_kw", "Int32", int32),
        ], undefined)]),
      ],
      isStabilityTracked: false,
      isStable: false,
      kind: "struct",
      name: "Counter",
      parameters: [],
      parentTraits: [
        { name: "AnyType", path: "/std/traits/anytype/AnyType" },
        { name: "Deinitable", path: "/std/traits/deinitable/Deinitable" },
        { name: "Movable", path: "/std/traits/movable/Movable" },
      ],
      signature: "struct Counter",
      sinceVersion: "",
      summary: "",
    }, struct("Bucket", {
      aliases: [{
        deprecated: "",
        description: "",
        isStabilityTracked: false,
        isStable: false,
        kind: "alias",
        name: "Element",
        parameters: [],
        path: "/probe/api/#element",
        signature: "comptime Element",
        sinceVersion: "",
        summary: "",
        type: "AnyType",
        value: "T",
      }],
      fields: [{ description: "", kind: "field", name: "value", summary: "", type: "T" }],
      functions: [group("item", [overload("item", [
        argument("self", "ref", "pos_or_kw", "Self"),
      ], typeValue("Self.Element"))])],
      parameters: [{
        description: "",
        kind: "parameter",
        name: "T",
        passingKind: "pos",
        ...typeValue("Sequence", "/probe/traits/Sequence"),
      }],
      parentTraits: [
        { name: "Sequence", path: "/probe/traits/Sequence" },
        {
          condition: "conforms_to(T, Copyable)",
          name: "Copyable",
          path: "/probe/traits/Copyable",
        },
      ],
      signature: "struct Bucket[T: Sequence]",
    })],
    summary: "",
    traits: [],
  };
const traitsModule = {
  aliases: [],
  description: "",
  functions: [],
  kind: "module",
  name: "traits",
  structs: [struct("Flag")],
  summary: "",
  traits: [
    trait("Sequence"),
    trait("Copyable"),
    trait("Iterator", {
      aliases: [alias("Element", "AnyType", "", "/probe/traits/#element")],
    }),
  ],
};
const privateAlias = (name, type, value) =>
  alias(name, type, value, `/probe/_private/${name}`);
const privateModule = {
  aliases: [
    privateAlias("TypeAlias", "AnyType", "Int32"),
    privateAlias("OriginAlias", "Int32", "ImmStaticOrigin"),
    privateAlias("ValueAlias", "Int32", "Int32(0)"),
  ],
  description: "",
  functions: [],
  kind: "module",
  name: "_private",
  structs: [],
  summary: "",
  traits: [],
};
const surfaceModule = {
  aliases: [],
  description: "",
  functions: [],
  kind: "module",
  name: "__init__",
  structs: [],
  summary: "",
  traits: [],
};
const extraModules = process.env.TSONIC_MOJO_PROVIDER_EXTRA_MODULE === undefined
  ? []
  : [{
      aliases: [],
      description: "",
      functions: [],
      kind: "module",
      name: process.env.TSONIC_MOJO_PROVIDER_EXTRA_MODULE,
      structs: [],
      summary: "",
      traits: [],
    }];

writeFileSync(args[outputIndex + 1], JSON.stringify({
  decl: {
    description: "",
    kind: "package",
    modules: [apiModule, privateModule, traitsModule, ...extraModules],
    name: "probe",
    packages: [{
      description: "",
      kind: "package",
      modules: [surfaceModule],
      name: "surface",
      packages: [],
      summary: "",
    }],
    summary: "",
  },
  version: "1.1.0.dev2026083005",
}));
