import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseMojoDocDocument } from "../../dist/providers/compiler/model/mojo-doc-schema.js";
import { normalizeMojoDocModule } from "../../dist/providers/compiler/model/normalization.js";
import { projectMojoCompilerModule } from "../../dist/providers/compiler/projection/projection.js";
import { mojoCompilerSignatureReferences } from "../../dist/providers/compiler/model/signature-origins.js";

export function verifyCompilerMetadata(workspace, mojo, guarded) {
  const output = join(workspace, "compiler-metadata");
  mkdirSync(output, { recursive: true });
  const source = `from std.origin import ImmOrigin, MutOrigin
def borrow[origin: Origin](ref[origin] value: Int32) -> ref[origin] Int32:
    return value
def borrow_mut[origin: MutOrigin](ref[origin] value: Int32) -> ref[origin] Int32:
    return value
def borrow_imm[origin: ImmOrigin](ref[origin] value: Int32) -> ref[origin] Int32:
    return value
def elided(ref value: Int32) -> Int32:
    return value
@fieldwise_init
struct Cell:
    var value: Int32
    def read(ref self) -> Int32:
        return self.value
    def borrowed[origin: Origin](ref[origin] self) -> ref[origin] Self:
        return self
struct Family[T: Copyable & Deinitable](Copyable):
    comptime Element = Self.T
    var value: Self.T
    def __init__(out self, var value: Self.T):
        self.value = value^
    def read(self) -> Self.Element:
        return self.value.copy()
`;
  const sourcePath = join(output, "native_metadata.mojo");
  const documentPath = join(output, "native_metadata.json");
  writeFileSync(sourcePath, source);
  guarded(mojo, ["doc", sourcePath, "-o", documentPath]);
  const document = parseMojoDocDocument(JSON.parse(readFileSync(documentPath, "utf8")));
  const package_ = { id: "native-metadata", alias: "native-metadata", packageName: "native_metadata", version: "1", kind: "package", modules: [{ modulePath: [] }] };
  const typeConstraints = new Set(["/std/traits/copyable/Copyable", "/std/traits/deinitable/Deinitable"]);
  const model = normalizeMojoDocModule({
    package: package_, modulePath: [], sourceDigest: createHash("sha256").update(source).digest("hex"), document,
    resolveTypePath: (_name, path) => path,
    classifyGenericParameter: ({ parameter }) => {
      if (["/std/origin/Origin", "/std/origin/#mutorigin", "/std/origin/#immorigin"].includes(parameter.path)) return "origin";
      assert.ok(parameter.traits?.length > 0);
      for (const trait of parameter.traits) assert.ok(typeConstraints.has(trait.path));
      return "type";
    },
    classifyAlias: ({ declaration, owner }) => {
      assert.equal(owner.name, "Family");
      assert.equal(declaration.name, "Element");
      assert.equal(declaration.value, "T");
      return "type";
    },
  });
  const borrow = model.functions.find(({ name }) => name === "borrow");
  assert.equal(borrow.arguments[0].type.kind, "reference");
  assert.equal(borrow.arguments[0].type.origin, "origin");
  assert.equal(borrow.result.origin, "origin");
  const standard = { id: "std", alias: "std", packageName: "std", version: document.version, kind: "standard-library",
    modules: [{ modulePath: ["traits", "copyable"] }, { modulePath: ["traits", "deinitable"] }, { modulePath: ["origin"] }] };
  const projection = projectMojoCompilerModule({ packages: [package_, standard] }, package_, model, {
    providerModuleId: "test:native-metadata", moduleSpecifier: "test:native-metadata",
    exports: ["borrow", "borrow_mut", "borrow_imm", "elided", "Cell", "Family"].map((name) => ({ declarationName: name, exportName: name })),
  });
  const selected = projection.declarationModel.exports.find(({ name }) => name === "borrow").signatures[0];
  assert.equal(selected.parameters[0].type.exportName, "Ref");
  assert.equal(selected.returnType.exportName, "Ref");
  for (const [name, origin, reference] of [["borrow_mut", "MutOrigin", "MutRef"], ["borrow_imm", "ImmOrigin", "Ref"]]) {
    const selected = projection.declarationModel.exports.find((item) => item.name === name).signatures[0];
    assert.equal(selected.typeParameters[0].constraints[0].exportName, origin);
    assert.equal(selected.parameters[0].type.exportName, reference);
    assert.equal(selected.returnType.exportName, reference);
  }
  assert.equal(model.functions.find((item) => item.name === "elided").arguments[0].type.kind, "named");
  const cell = model.declarations.find((item) => item.name === "Cell");
  assert.equal(cell.functions.find((item) => item.name === "read").arguments[0].type.kind, "self");
  const borrowedSelf = cell.functions.find((item) => item.name === "borrowed").arguments[0].type;
  assert.equal(borrowedSelf.kind, "reference");
  assert.equal(borrowedSelf.origin, "origin");
  assert.equal(borrowedSelf.target.kind, "self");
  const family = projection.declarationModel.exports.find(({ name }) => name === "Family");
  assert.deepEqual(family.members.find(({ name }) => name === "read").signatures[0].returnType, { kind: "type-parameter", name: "T" });
  const original = document.decl.functions.find(({ name }) => name === "borrow").overloads[0];
  const scope = { originParameters: new Set(["origin"]) };
  for (const signature of ["", original.signature.replace("ref[origin] value", "ref[origin] wrong"),
    original.signature.replace("value: Int32", "value: UInt32"), original.signature.replace("(ref", "(unused: Int32, ref")]) {
    assert.throws(() => mojoCompilerSignatureReferences({ ...original, signature }, scope), /reference signature/u);
  }
  writeFileSync(join(output, "projection.json"), JSON.stringify(projection, null, 2));
}
