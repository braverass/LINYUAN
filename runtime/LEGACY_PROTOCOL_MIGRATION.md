# Legacy Protocol Migration · COMPLETE

The compatibility file `00A-按需读取与写作执行协议.md` has been repurposed as the Spec 0.5 Retrieval / Compilation Protocol.

The old execution model:

```text
one Agent
-> read Canon
-> keep same message history
-> write fiction
```

is retired.

The active model is:

```text
Retriever/Compiler context
-> serialized ACTIVE_CONTEXT
-> NEW Generator inference
-> Validator
-> evidence-stripped Local Patcher
```

Path selection in the operational protocol now uses semantic IDs. SOURCE_REGISTRY alone owns physical path resolution.

Any legacy physical path text that still exists inside Raw Canon documents is treated as document content, not as a runtime read command.
