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

## Native value predicates

A provider may declare a `value-predicate` operation for a single non-generic
native carrier. It is not a runtime name or shape test:

```typescript
target: {
  kind: "value-predicate",
  predicate: {
    acceptedType: bufferCarrier,
    boxed: { modulePath: ["tsonic_node", "buffer"], name: "buffer_is_buffer" },
  },
  genericParameters: [{
    kind: "type", name: "T", position: "inferred",
    variadic: false, constraints: [],
  }],
  arguments: [{ convention: "imm", position: "positional-or-keyword" }],
}
```

The source signature has one required argument; the operation returns Bool and
does not raise. Analysis selects true/false for concrete native carriers,
distributes across exact Optional/Variant members, and selects the declared
brand operation for JsValue. Planning consumes that selection and preserves
argument evaluation, including side effects even when the result is constant.
It does not allocate a JsValue just to test a native value.

For `function check<T>(value: T) { return Buffer.isBuffer(value); }`, the existing
finite callable-specialization graph closes each used instantiation and its
callers. An open externally-instantiable library wrapper cannot silently produce
false: it fails at the finite-specialization boundary. No new native overload
interpreter, string-based type tests or competing predicate implementation is
permitted. Other providers can state the same operation with their own exact
carrier and branded-value function identities.

## Recovering A Retained Carrier

The independent `sourceValueExtraction` relation declares the exact inverse
operation when the provider supports it:

```typescript
sourceValueExtraction: {
  modulePath: ["native_package", "values"],
  name: "recover_record",
}
```

This function borrows `JsValue`, returns the exact native type and raises native
`Error` when the value does not have that carrier. It must validate retained
identity/data rather than structurally casting a lookalike or deserializing JSON.
The two operations need not both exist. A factory does not implicitly authorize
extraction. Competing extraction identities on the same exact type are rejected.

For example, `(saved as Buffer).toString()` calls `buffer_from_js_value`. It
recovers the live Buffer's storage, subview bounds and object identity without a
byte copy. An unbranded structured clone or `{type: "Buffer", data: [...]}` is not
a Buffer and fails at this conversion. Analysis retains the native-error effect
so a surrounding source `try` can catch rejection normally.
