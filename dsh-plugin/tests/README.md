# Native regression and exposed fixtures

`native/` contains the existing native test cases and shared test helper.
`core-bridge.test.js` protects the explicit legacy integration.
`fixtures/` contains public, already-consumed research regression inputs with
their original notices, provenance and bytes.

Run the [product gate](../../docs/development/TESTING.md), or from the repository
root, with DUO_DSH_PACKAGE pointing to the existing host:

```sh
node --loader ./scripts/product/dsh_native_loader.mjs --test dsh-plugin/tests/native/*.test.js dsh-plugin/tests/*.test.js
```

Nothing in this directory ships in the npm tarball. The supported public fixture
export remains the existing `native/offline-fixture.js`; moving tests does not
remove that compatibility API. Fixture labels such as final never mean unseen
evaluation data.
