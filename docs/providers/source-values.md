# Retained provider values

A closed provider type can declare its exact native conversion to the JavaScript
closed-value carrier. This supplies representation, not overload selection:

```typescript
const type = {
  ...declaredNativeType,
  sourceValueFactory: {
    modulePath: ["native_package", "values"],
    name: "retain_record",
  },
};
```

The selected function borrows the exact declared carrier and returns `JsValue`
without raising. The provider owns retention, allocation identity, data and
presentation semantics. The function must not snapshot a mutable source object,
discover members or pretend its JSON presentation is its runtime data.

The current contract admits closed target-named types with no source generic
parameters. No factory is inferred for an unregistered type. Two provider aliases
for the same exact carrier must state the same factory identity. Metadata is
captured with the provider package, analysis seals the selected factory in the
source-value graph, and planning only emits that selected call.

For example, `const value: unknown = Buffer.from([1, 2])` invokes the Node
provider's `buffer_to_js_value`, preserving live bytes and Buffer identity.
`Buffer.isBuffer(value)` checks the retained producer brand, not an object field
or class-name spelling. Structured cloning has its separate byte-view contract;
it does not invoke `toJSON` or preserve the Buffer prototype/brand.

This does not enable arbitrary native objects, native value-copy aggregates or
open generic factories. Those require their own complete representation contract.
