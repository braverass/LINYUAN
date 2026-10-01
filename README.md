# 零渊 · LINYUAN

《零渊》世界设定 Canon，以及把设定“编译”成可用于小说创作的上下文的运行时（TypeScript）。

> **如果你是 AI**：先读 [`AI_ENTRY.md`](AI_ENTRY.md)，再读 [`CHAT-FICTION-GUIDE.md`](CHAT-FICTION-GUIDE.md)。**不要**为了“熟悉世界观”通读全部文件——总量约 2.7 MB，且绝大部分与当前场景无关。
> 机器可读的文件清单与直链见 [`llms.txt`](llms.txt)。

## 仓库里有什么

| 内容 | 位置 |
|---|---|
| 入口与模式路由 | [`AI_ENTRY.md`](AI_ENTRY.md)、[`MODE-FICTION.md`](MODE-FICTION.md)、[`MODE-EXPLAIN.md`](MODE-EXPLAIN.md) |
| semantic ID ↔ 文件路径 | [`SOURCE_REGISTRY.yaml`](SOURCE_REGISTRY.yaml) |
| 检索/编译协议 | [`00A-按需读取与写作执行协议.md`](00A-按需读取与写作执行协议.md) |
| 作者层规则与 Canon | `00A-AUTHOR-ROUTER.md`、`00B`–`00L` |
| 大文件章节目录（自动生成） | [`SECTION-INDEX.md`](SECTION-INDEX.md)（`npm run index:sections` 重新生成） |
| 世界设定分卷 | `01`–`05` 各 `*-完整合集.md`；`00-零渊世界设定-完整合集.md` 为兜底大包 |
| 运行时（Retriever / Compiler / Generator / Validator / Patcher） | [`runtime/`](runtime/README.md) |
| 评测 | [`evals/`](evals/README.md) |
| 规格 | [`SPEC-0.9-LIVE-E2E.md`](SPEC-0.9-LIVE-E2E.md)、[`SPEC-1.0-EVIDENCE-VERIFICATION.md`](SPEC-1.0-EVIDENCE-VERIFICATION.md) |

完整的 Canon 文件清单（含大小、用途、何时读取）见 [`llms.txt`](llms.txt)。

## 怎么用来写小说

### 方式 A：网页聊天（无需安装，推荐入门）
按 [`CHAT-FICTION-GUIDE.md`](CHAT-FICTION-GUIDE.md) 的**两步流程**：
1. 新对话 ①：上传最少的几个文件，让模型产出一份**编译简报**（事实 / 约束 / 未知项）。
2. 新对话 ②：只贴简报 + 场景状态 + 本次请求，让模型写正文。

这样大文件只在第 1 步被读一次，写作上下文干净、短、不被设定说明污染。

### 方式 B：完整运行时（符合 Spec 0.5 FICTION）
需要 Node.js 和模型 API Key，由 `runtime/orchestrator.ts` 创建彼此独立的多次推理调用：

```bash
npm install
npm run fiction:live -- --request "<小说请求>" [--scene-file scene.json]
npm run fiction:live:help   # 查看全部参数
```

模型通过环境变量配置（实现见 `runtime/model/providers.ts`），最小示例：

```bash
export LINYUAN_MODEL_PROVIDER=anthropic   # openai | gemini | anthropic
export LINYUAN_MODEL_ID=<模型 ID>
export ANTHROPIC_API_KEY=<你的 key>       # 或 OPENAI_API_KEY / GEMINI_API_KEY / LINYUAN_MODEL_API_KEY
```

也可以按阶段分别配置（前缀形如 `LINYUAN_<STAGE>_PROVIDER` / `_MODEL` / `_API_KEY`）。

> 注意：单个聊天窗口无法创建独立的 inference calls，因此**不能宣称**符合 Spec 0.5 FICTION runtime（见 `AI_ENTRY.md`）。方式 A 只是在此限制下的近似做法。

## 开发

```bash
npm run typecheck
npm test
npm run lint:registry
npm run index:sections        # 修改 Canon 后重新生成 SECTION-INDEX.md
npm run index:sections:check  # 检查目录是否过期
npm run ci      # 全部检查
```

## 读取失败时（给人看的排查）

- 仓库是公开的，默认分支为 `main`，不需要任何权限。
- 抓取工具返回 404/403 多半是工具侧被 GitHub 限流或拦截。换用 `raw.githubusercontent.com` 直链（见 `llms.txt`），或直接 `git clone https://github.com/braverass/LINYUAN.git`。
- `00-零渊世界设定-完整合集.md` 约 1.1 MB，多数网页抓取工具会截断或拒绝。请改读更窄的分卷，或把文件作为附件上传后让模型**先搜索定位、再读相关章节**。[`SECTION-INDEX.md`](SECTION-INDEX.md) 列出了每个大文件的章节标题与行号范围，可以直接按范围读取。
