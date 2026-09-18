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

## Default user-facing output

除非用户明确要求“证据”“出处”“读取过程”“Canon 原文”“引用”“审计”或类似内容，EXPLAIN 的默认回复必须直接回答用户实际问题，不展示内部检索过程。

默认禁止在用户可见回复中：

- 汇报“本次读取了哪些 Canon / 文件”；
- 复述路由决策、Retrieval Planner、Retriever 或 Compiler 的工作过程；
- 大段转述或逐条念出 Canon；
- 为证明已经检索而堆砌来源、文件名、权限等级或内部术语；
- 在结论前加入与问题无关的运行状态、模式说明或检索清单。

默认应当：

1. 在后台按路由读取最小充分 Canon；
2. 用 Canon 约束推理；
3. 直接给出“会发生什么 / 是什么 / 为什么”的自然语言答案；
4. 只保留理解结论真正需要的设定信息；
5. 用户追问依据时，再展开来源、证据链、冲突层级或 Canon 原文。

简言之：**Canon 是回答的依据，不是默认回答内容。**

EXPLAIN 的 evidence-rich context 不得被复用为后续 FICTION Generator history。需要转入创作时，重新从 REQUEST / SCENE_STATE 开始，经过 Compiler 生成新的 ACTIVE_CONTEXT。
