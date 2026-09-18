# MODE-EXPLAIN · Explanation Contract

EXPLAIN 与 FICTION 是独立运行模式。

适用于：

- 设定解释；
- 正典核对；
- 冲突定位；
- 来源说明；
- 人物/制度/世界分析；
- 为什么某项裁定成立。

EXPLAIN 可以读取 Retriever 的证据、semantic IDs 和 provenance，并应明确区分：

- 作者层事实；
- 客观机制；
- 世界内观察/解释；
- 派生推论；
- 未知或冲突。

EXPLAIN 的 evidence-rich context 不得被复用为后续 FICTION Generator history。需要转入创作时，重新从 REQUEST / SCENE_STATE 开始，经过 Compiler 生成新的 ACTIVE_CONTEXT。
