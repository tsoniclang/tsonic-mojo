import assert from "node:assert/strict";
import test from "node:test";
import { mojoConversionRaises, mojoConversionDependencies } from "../../../dist/analysis/resources/effects.js";
import { mojoValueConversionEquals } from "../../../dist/target-model/conversions/equality.js";
import { mojoSourceProfileCallRows } from "../../../dist/policy/operations/source-profile-selection.js";

test("source runtime overload rows distinguish array and iterator errors", () => {
  const rows = mojoSourceProfileCallRows.filter((row) => row.owner === "ArrayConstructor" && row.member === "from" && row.argumentCount === 1);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    for (const carrier of row.argumentCarriers[0].oneOf) assert.equal(row.raises, carrier === "js-array");
  }
  const dates = mojoSourceProfileCallRows.filter((row) => row.owner === "DateConstructor" && row.kind === "construct" && row.argumentCount === 1);
  assert.equal(dates.length, 2);
  for (const row of dates) {
    for (const carrier of row.argumentCarriers[0].oneOf) assert.equal(row.raises, carrier === "js-string" || carrier === "native-string");
  }
});

test("empty collection conversions do not read holes or invoke element callbacks", () => {
  assert.equal(mojoConversionRaises({ kind: "collection-map", source: "js-array" }), false);
  assert.equal(mojoConversionRaises({ kind: "collection-map", source: "js-array", elementConversion: { kind: "identity" } }), true);
  assert.equal(mojoConversionRaises({ kind: "collection-map", source: "list", elementConversion: { kind: "js-to-native-string" } }), true);
});

test("record conversions retain selected identities, nested effects and getter dependencies", () => {
  const declaration = Object.freeze({});
  const sourceType = { kind: "native-string" };
  const targetType = { kind: "source-primitive", name: "float64" };
  const field = { memberId: "provider.field", targetName: "native_field", sourceType, targetType,
    read: { kind: "accessor", declaration, name: "getter" }, conversion: { kind: "identity" } };
  const record = { kind: "provider-record", sourceType, targetType, fields: [field] };
  assert.equal(mojoConversionRaises(record), false);
  assert.deepEqual(mojoConversionDependencies(record), [declaration]);
  assert.equal(mojoValueConversionEquals(record, { ...record }), true);
  for (const mutation of [
    { memberId: "other" }, { targetName: "other" },
    { read: { ...field.read, declaration: {} } }, { read: { ...field.read, name: "other" } },
  ]) assert.equal(mojoValueConversionEquals(record, { ...record, fields: [{ ...field, ...mutation }] }), false);
  assert.equal(mojoConversionRaises({ ...record, fields: [{ ...field, conversion: { kind: "js-to-native-string" } }] }), true);
});
