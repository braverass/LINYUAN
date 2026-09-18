# AI_ENTRY · Spec 0.5

这是《零渊》AI 任务的运行时入口，不承载 Canon。

## Mode routing

### FICTION

适用于正文、续写、场景、对白和角色互动。

执行：

`REQUEST -> Retrieval Planner -> Retriever -> Compiler -> ACTIVE_CONTEXT -> NEW Generator inference -> Validator -> Local Patcher`

必须使用 `MODE-FICTION.md`。Raw Canon 和 provenance 不得进入 Generator 或 Patcher。

### EXPLAIN

适用于设定解释、核对、分析、来源说明和冲突定位。

执行独立的检索/解释上下文，使用 `MODE-EXPLAIN.md`。解释链可以引用来源，但不得复用为 Fiction Generator 的 message history。

## Runtime authority

- semantic ID / physical path：`SOURCE_REGISTRY.yaml`
- retrieval / compilation：`00A-按需读取与写作执行协议.md`
- executable boundary：`runtime/orchestrator.ts`
- IR：`runtime/schemas/ACTIVE_CONTEXT.schema.yaml`
- validation：`runtime/schemas/VALIDATION.schema.yaml`
- patching：`runtime/schemas/PATCH.schema.yaml`
- trace：`runtime/schemas/RUN_TRACE.schema.yaml`

如果环境无法创建独立 inference calls，不能宣称符合 Spec 0.5 FICTION runtime。
