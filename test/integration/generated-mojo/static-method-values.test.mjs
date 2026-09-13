import assert from "node:assert/strict";
import test from "node:test";
import { artifactTexts, compileMojo } from "../../helpers/mojo-session.mjs";

for (const member of ["double", '"double-value"']) {
  test(`selected static method ${member} becomes one canonical function value`, () => {
    const access = member.startsWith('"') ? `Operations[${member}]` : `Operations.${member}`;
    const result = compileMojo({ files: { "index.ts": `
class Operations { static ${member}(value: number): number { return value * 2; } }
export function invoke(): number {
  const transform = ${access};
  return transform(7);
}
export function main(): void {}
` } });
    assert.deepEqual(result.diagnostics, []);
    const source = artifactTexts(result).filter((item) => item.path.startsWith("src/")).map((item) => item.text).join("\n");
    assert.match(source, /Operations\.double/u);
    assert.match(source, /Callable\[/u);
  });
}

test("static method identity stays attached to the declaration across module aliases", () => {
  const result = compileMojo({ files: {
    "operations.ts": "export class First { static apply(value: number): number { return value + 1; } } export class Second { static apply(value: number): number { return value + 2; } }",
    "index.ts": `
import { First as Operations, Second } from "./operations.js";
export function compare(): boolean {
  const first = Operations.apply;
  const again = Operations.apply;
  const second = Second.apply;
  return first === again && first !== second;
}
export function main(): void {}
`,
  } });
  assert.deepEqual(result.diagnostics, []);
});
