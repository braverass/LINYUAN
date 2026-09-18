# Registry Integrity · Spec 0.5

The executable check is `runtime/ci/lint-registry.ts`.

It enforces:

1. every semantic ID has a physical path;
2. every registered path exists in the checkout;
3. every Canon/data source has `instruction_capability: false`;
4. Generator raw-source permission is `deny`;
5. Patcher raw-source permission is `deny`.

Run:

```bash
npm run lint:registry
```

Operational protocols may refer to semantic IDs. Physical paths inside Raw Canon text are never treated as executable retrieval instructions; only SOURCE_REGISTRY resolves paths.
