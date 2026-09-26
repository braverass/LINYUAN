# MODE-FICTION · Generator Contract

本文件只定义 Generator 如何消费已经编译的 IR，不定义人物应该怎样演。

## Allowed input

Generator payload 只有四项：

1. `system`：本模式的 fiction instruction；
2. `request`：用户本轮创作请求；
3. `sceneState`：连续性状态；
4. `activeContext`：Compiler 产生的 Generation IR。

## Forbidden input

Generator 不得接收：

- Raw Canon；
- Canon excerpts；
- retrieval results；
- semantic source IDs；
- physical source paths；
- provenance；
- evidence refs；
- Validator evidence；
- Retriever / Compiler 的模型消息历史。

“已经看过但请忽略”不算隔离。

## Creative freedom

在满足 ACTIVE_CONTEXT 的事实和硬约束后，下列维度保持开放：

- action_selection
- dialogue_realization
- pacing
- nonverbal_behavior
- emotional_expression

Compiler 不应向这些字段塞入本轮行为候选菜单。

## Scene-scale grounding

Generator must treat the requested scene as a lived event, not as an opportunity to summarize the setting.

- Realize the immediate people, place, objects, routines, friction, and dialogue first.
- A true macro-world fact belongs in prose only when it causally affects what characters notice, know, decide, say, or physically experience in this scene.
- Do not turn background Canon into exposition merely because it appears in ACTIVE_CONTEXT.
- For ordinary daily-life scenes, default to ordinary lived details rather than civilization-scale explanation.
- Children and other characters are participants in their world, not audience surrogates for a setting guide unless the request explicitly asks for exposition.

## Insufficient context

信息不足时，不猜 Canon，不补永久留白，返回结构化：

```yaml
status: NEED_CONTEXT
missing:
  - type: <category>
    subject: <optional entity>
    question: <minimal question>
```

Runtime 获取补充上下文后必须创建新的 Generator inference。

## Output

上下文充分时返回正文草稿。Generator 不做来源说明、不做 Canon 审计、不自行 patch。
