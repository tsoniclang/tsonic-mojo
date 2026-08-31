import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--version") {
  process.stdout.write("Mojo 1.1.0.dev2026083005 (fixture)\n");
  process.exit(0);
}

if (args[0] !== "doc") {
  process.stderr.write(`unsupported fake Mojo command: ${args.join(" ")}\n`);
  process.exit(2);
}

const outputIndex = args.indexOf("-o");
if (outputIndex < 0 || args[outputIndex + 1] === undefined) {
  process.stderr.write("missing metadata output path\n");
  process.exit(2);
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

writeFileSync(args[outputIndex + 1], JSON.stringify({
  decl: {
    aliases: [],
    description: "",
    functions: [group("sum", [overload("sum", [
      argument("left", "imm", "pos_or_kw", "Int32", int32),
      argument("right", "imm", "kw", "Int32", int32, "Int32(0)"),
    ], typeValue("Int32", int32))])],
    kind: "module",
    name: "api",
    structs: [{
      aliases: [],
      constraints: "",
      convention: "memory_only",
      deprecated: "",
      description: "",
      fields: [{ description: "", kind: "field", name: "value", summary: "", type: "Int32" }],
      functions: [
        group("__init__", [overload("__init__", [
          argument("value", "imm", "pos_or_kw", "Int32", int32),
          argument("self", "out", "pos_or_kw", "Self"),
        ], typeValue("Self"))]),
        group("increment", [overload("increment", [
          argument("self", "mut", "pos_or_kw", "Self"),
          argument("amount", "imm", "pos_or_kw", "Int32", int32),
        ], typeValue("Int32", int32))]),
      ],
      isStabilityTracked: false,
      isStable: false,
      kind: "struct",
      name: "Counter",
      parameters: [],
      parentTraits: [],
      signature: "struct Counter",
      sinceVersion: "",
      summary: "",
    }],
    summary: "",
    traits: [],
  },
  version: "1.1.0.dev2026083005",
}));
