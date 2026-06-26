# AgentMemory 融入 OpenHarness 执行计划（已合并）

> **此文档已被合并到 `docs/unified-execution-plan.zh-CN.md`**，与 Claude Code 对齐计划合为一条统一执行路线。以下内容保留供参考。

## 背景分析

### AgentMemory 核心机制

| 机制 | 说明 |
|------|------|
| **4 层记忆整合** | Working（原始观测）→ Episodic（会话摘要）→ Semantic（事实/模式）→ Procedural（工作流/决策） |
| **混合检索** | BM25 + 向量嵌入 + 知识图谱，RRF 融合，session 去重 |
| **12 个自动 Hook** | SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / PostToolUseFailure / PreCompact / SubagentStart / SubagentStop / Stop / SessionEnd 等 |
| **自动压缩** | 工具调用后 SHA-256 去重 → 隐私过滤 → LLM 压缩 → 嵌入索引 |
| **记忆衰减** | Ebbinghaus 曲线，频繁访问强化，过期自动淘汰，矛盾检测 |
| **MCP Server** | 53 个 MCP 工具，REST API，实时查看器（端口 3113） |
| **Claude Bridge** | 双向同步 MEMORY.md |

### OpenHarness 现有记忆体系

| 子系统 | 位置 | 状态 |
|--------|------|------|
| **文件记忆** | `.openharness/memory/` — memory.md 索引 + daily 文件 + topic 文件 | 可用，但仅靠 agent 自行 grep/read |
| **AI Memory Points** | `ai_memories.json` — 结构化 JSON（title/content/tags/importance） | 可用，独立于文件记忆 |
| **Scoped Agent Memory** | `.claude/agent-memory/{agent}/MEMORY.md` | 可用，Claude Code 兼容 |
| **Claude 规则加载** | CLAUDE.md / .claude/CLAUDE.md / .claude/rules/*.md | 可用，@import 递归 |
| **Hook 系统** | `AgentHookConfig` — 5 个生命周期点 | 框架完整，仅 2/5 实际接线 |
| **MCP 基础设施** | `MCPServerManager` / `MCPToolAdapter` / rmcp 0.12.0 | 完整可用 |

### 差距总结

1. **无自动记忆捕获** — 完全依赖 agent 手动读写
2. **无语义检索** — 只有 grep，没有嵌入/向量搜索
3. **无记忆整合管道** — 没有压缩、分层、衰减机制
4. **Hook 接线不完整** — 仅 `before_agent_start` 和 `before_agent_finish` 实际执行
5. **无跨会话记忆积累** — 每次会话独立，不自动沉淀知识

---

## 整体方案：三层融合

采用**渐进式融合**策略，不直接嵌入 agentmemory 源码，而是将其核心设计模式用 Rust 原生实现，融入 OpenHarness 现有架构。

```
┌─────────────────────────────────────────────────┐
│              Agent Prompt Assembly               │
│  {AGENT_MEMORY} + {MEMORIES} + {PROJECT_CONTEXT} │
└──────────────┬──────────────────────┬────────────┘
               │                      │
       ┌───────▼───────┐    ┌─────────▼─────────┐
       │  Memory Read   │    │  Memory Inject    │
       │  (检索层)       │    │  (注入层)          │
       │  BM25 + 向量    │    │  Token 预算裁剪    │
       └───────┬───────┘    └─────────▲─────────┘
               │                      │
       ┌───────▼──────────────────────┴───────┐
       │          Memory Engine (核心)          │
       │  4 层整合 │ 衰减 │ 去重 │ 矛盾检测     │
       └───────▲──────────────────────┬───────┘
               │                      │
       ┌───────┴───────┐    ┌─────────▼─────────┐
       │  Memory Write  │    │  Memory Capture   │
       │  (写入层)       │    │  (捕获层)          │
       │  结构化存储      │    │  Hook 自动采集     │
       └───────────────┘    └───────────────────┘
```

---

## 阶段一：Hook 接线补全 + 自动记忆捕获（P0）

**目标**：让 Hook 系统完整工作，实现工具调用的自动记忆采集。

### 1.1 补全 Round Executor 中的 Hook 调用点

**文件**：`src/crates/core/src/agentic/execution/round_executor.rs`

**任务**：
- [ ] 在模型请求前调用 `before_model_request` hooks
- [ ] 在工具调用前调用 `before_tool_call` hooks（支持 matcher 过滤）
- [ ] 在工具结果返回后调用 `after_tool_result` hooks
- [ ] 确保 hook 失败有明确的阻断/继续策略
- [ ] 为每个 hook 调用点注入上下文变量（tool_name, tool_input, tool_output 等）

**验收**：
```powershell
cargo test -p openharness-core hook_before_tool_call -- --nocapture
cargo test -p openharness-core hook_after_tool_result -- --nocapture
cargo test -p openharness-core hook_matcher_filter -- --nocapture
```

### 1.2 实现 MemoryCaptureService

**新文件**：`src/crates/core/src/service/agent_memory/capture.rs`

**职责**：监听 Hook 事件，自动提取结构化记忆。

```rust
pub struct MemoryCaptureService {
    workspace_root: PathBuf,
    dedup_cache: DashMap<String, Instant>,  // SHA-256 → 时间戳，5min 窗口去重
    privacy_filter: PrivacyFilter,
}

pub struct CapturedObservation {
    pub tool_name: String,
    pub tool_input_summary: String,
    pub tool_output_summary: String,
    pub file_paths: Vec<PathBuf>,
    pub timestamp: DateTime<Utc>,
    pub session_id: String,
    pub agent_name: String,
}
```

**关键逻辑**：
- `on_post_tool_use()` — 接收工具调用结果，SHA-256 去重
- `privacy_filter()` — 过滤 API key、secret、token 等敏感信息
- `extract_observation()` — 从原始工具调用中提取结构化观测
- `persist_observation()` — 写入 `.openharness/memory/observations/` 目录

**隐私过滤规则**（对齐 agentmemory）：
- 匹配 `sk-*`, `ghp_*`, `Bearer *`, `-----BEGIN.*KEY-----`
- 匹配环境变量模式 `${SECRET}`, `${API_KEY}`
- 匹配 `<private>` 标签包裹的内容

### 1.3 Hook 事件 → MemoryCaptureService 接线

**文件**：`src/crates/core/src/agentic/execution/execution_engine.rs`

在现有 hook 执行流程中注入 MemoryCaptureService 调用：

```
before_agent_start  → capture_service.on_session_start(session_id, workspace)
after_tool_result   → capture_service.on_post_tool_use(tool_name, input, output)
before_agent_finish → capture_service.on_session_end(session_id)
```

**验收**：
```powershell
cargo test -p openharness-core memory_capture_dedup -- --nocapture
cargo test -p openharness-core memory_capture_privacy -- --nocapture
```

---

## 阶段二：记忆引擎核心（P0）

**目标**：实现 4 层记忆整合和基础检索。

### 2.1 定义记忆模型

**新文件**：`src/crates/core/src/service/agent_memory/models.rs`

```rust
pub enum MemoryTier {
    Working,     // 原始观测，短期
    Episodic,    // 会话摘要
    Semantic,    // 提取的事实和模式
    Procedural,  // 工作流和决策模式
}

pub struct MemoryEntry {
    pub id: String,
    pub tier: MemoryTier,
    pub content: String,
    pub embedding: Option<Vec<f32>>,
    pub source_observations: Vec<String>,  // 来源观测 ID
    pub session_id: String,
    pub agent_name: String,
    pub created_at: DateTime<Utc>,
    pub last_accessed: DateTime<Utc>,
    pub access_count: u32,
    pub importance: f32,        // 0.0 - 1.0
    pub decay_score: f32,       // Ebbinghaus 衰减
    pub tags: Vec<String>,
    pub file_paths: Vec<PathBuf>,
}

pub struct MemoryIndex {
    pub entries: Vec<MemoryEntry>,
    pub bm25_index: Bm25Index,
    pub vector_index: Option<VectorIndex>,
}
```

### 2.2 实现记忆存储层

**新文件**：`src/crates/core/src/service/agent_memory/storage.rs`

**存储策略**：
- Working 记忆：`.openharness/memory/working/` — JSON lines，按会话分文件
- Episodic 记忆：`.openharness/memory/episodic/` — 每个会话一个 `.md` 摘要
- Semantic 记忆：`.openharness/memory/semantic/` — 结构化 JSON，按主题分文件
- Procedural 记忆：`.openharness/memory/procedural/` — 工作流模式 JSON

**迁移兼容**：
- 现有 `.openharness/memory/memory.md` 继续作为索引文件
- 现有 daily/topic 文件映射到 Episodic/Semantic 层
- 现有 `ai_memories.json` 映射到 Semantic 层

### 2.3 实现记忆整合管道（Consolidation Pipeline）

**新文件**：`src/crates/core/src/service/agent_memory/consolidation.rs`

**整合流程**（对齐 agentmemory 的 4 层）：

```
会话结束时触发:
1. Working → Episodic: 用 LLM 将本次会话的原始观测压缩为摘要
2. Episodic → Semantic: 从摘要中提取事实、决策、偏好
3. Semantic → Procedural: 从重复出现的模式中提取工作流
4. 矛盾检测: 新事实与已有 Semantic 记忆冲突时标记/更新
5. 衰减计算: 所有记忆按 Ebbinghaus 曲线更新 decay_score
6. 淘汰: decay_score < 阈值且 access_count 低的记忆自动归档/删除
```

**依赖**：需要 LLM 调用（通过现有的 AI client 基础设施）。

### 2.4 实现 BM25 检索

**新文件**：`src/crates/core/src/service/agent_memory/search.rs`

**任务**：
- [ ] 基于现有 `grep-searcher` / `grep-regex` 依赖实现 BM25 评分
- [ ] 支持中英文分词（英文 stemming + 中文字符级 n-gram）
- [ ] 支持同义词扩展
- [ ] 结果按 session 去重（最多 3 条/session）
- [ ] 返回 top-K 结果，附带相关度分数

**向量检索**（可选，P2 阶段）：
- 本地嵌入模型（`all-MiniLM-L6-v2` 等 ONNX 模型）
- 或通过现有 AI client 调用嵌入 API
- 余弦相似度 + RRF 融合

**验收**：
```powershell
cargo test -p openharness-core memory_bm25_search -- --nocapture
cargo test -p openharness-core memory_session_dedup -- --nocapture
```

---

## 阶段三：记忆注入与 Prompt 集成（P1）

**目标**：让 agent 在会话开始时自动获得相关历史记忆。

### 3.1 增强 PromptBuilder

**文件**：`src/crates/core/src/agentic/agents/prompt_builder/prompt_builder_impl.rs`

**改造**：
- [ ] 修改 `build_workspace_agent_memory_prompt()`，从"列出所有文件"改为"检索最相关的记忆"
- [ ] 新增 `{SMART_MEMORY}` 占位符，替代现有的 `{AGENT_MEMORY}` 机械拼接
- [ ] 实现 token 预算控制（默认 2000 tokens），超限按 importance 裁剪
- [ ] 记忆注入格式对齐 agentmemory：

```
<memory_context>
## Project Memory (auto-captured)
- [Semantic] Auth uses JWT middleware in src/middleware/auth.ts (importance: 0.9, accessed: 5x)
- [Episodic] 2026-06-17: Fixed N+1 query in user service, added index on users.email
- [Procedural] When adding API endpoints: 1) define route 2) add handler 3) write tests 4) update OpenAPI spec

## Agent Memory (scoped)
- Per-agent MEMORY.md content
</memory_context>
```

### 3.2 会话开始时的记忆检索

**文件**：`src/crates/core/src/agentic/execution/execution_engine.rs`

在 `before_agent_start` 阶段：
1. 提取用户首条消息作为检索 query
2. 调用 `MemorySearchService::search(query, top_k=10, token_budget=2000)`
3. 将结果注入 `context_vars["smart_memory"]`
4. PromptBuilder 在组装 prompt 时使用该变量

### 3.3 会话结束时的记忆沉淀

在 `before_agent_finish` 阶段：
1. 收集本次会话所有 captured observations
2. 触发 Consolidation Pipeline
3. 更新记忆索引
4. 写入会话摘要到 episodic 层

---

## 阶段四：MCP 集成（P1）

**目标**：将记忆系统暴露为 MCP 工具，支持跨 agent 共享。

### 4.1 注册记忆 MCP 工具

**新文件**：`src/crates/core/src/service/agent_memory/mcp_tools.rs`

**暴露的 MCP 工具**（对齐 agentmemory 核心工具子集）：

| 工具名 | 功能 |
|--------|------|
| `memory_smart_search` | 混合检索（BM25 + 向量） |
| `memory_save` | 手动保存一条记忆 |
| `memory_sessions` | 列出历史会话 |
| `memory_session_detail` | 查看某次会话详情 |
| `memory_forget` | 删除指定记忆 |
| `memory_recap` | 生成当前会话摘要 |

### 4.2 Agent 生命周期中的 MCP 工具自动注册

**文件**：`src/crates/core/src/agentic/tools/registry.rs`

- [ ] 在工具注册时自动注入 memory MCP 工具
- [ ] 确保 memory 工具对所有 agent 可见（不被 `disallowedTools` 过滤，除非显式禁用）
- [ ] memory 工具的输入输出 schema 对齐 MCP 协议

---

## 阶段五：UI 集成（P2）

**目标**：在桌面端提供记忆可视化和管理界面。

### 5.1 记忆查看器

**新页面**：`src/web-ui/src/app/scenes/memory/`

- 时间线视图：按会话展示记忆积累
- 搜索界面：输入关键词检索记忆
- 记忆详情：查看来源观测、关联文件、衰减状态

### 5.2 记忆管理

- 手动编辑/删除记忆
- 记忆重要度调整
- 记忆导出/导入
- 每个 agent 的独立记忆空间入口

### 5.3 后端 API

**新文件**：`src/crates/core/src/service/agent_memory/api.rs`

暴露 REST/WebSocket 接口给前端：
- `GET /api/memory/search?q=...`
- `GET /api/memory/sessions`
- `GET /api/memory/sessions/{id}`
- `DELETE /api/memory/{id}`
- `WS /api/memory/stream` — 实时记忆更新推送

---

## 阶段六：高级特性（P2）

### 6.1 向量嵌入

- 集成本地 ONNX 推理（`all-MiniLM-L6-v2`）或通过 AI client 调用嵌入 API
- 在记忆写入时生成嵌入
- 在检索时用余弦相似度 + RRF 融合 BM25 和向量分数

### 6.2 知识图谱

- 从 Semantic 记忆中提取实体和关系
- 支持 BFS 遍历图谱进行关联检索
- 可视化知识图谱（前端 D3.js/force-graph）

### 6.3 跨 Agent 记忆共享

- 基于 MCP 的记忆共享协议
- 团队级记忆空间（namespace 隔离）
- 记忆所有权和权限控制

---

## 依赖变更

### 新增 Rust 依赖

| crate | 用途 | 阶段 |
|-------|------|------|
| `rust-stemmers` | 英文 stemming，BM25 分词 | 阶段二 |
| `jieba-rs` | 中文分词 | 阶段二 |
| `ort` (可选) | ONNX Runtime，本地嵌入推理 | 阶段六 |
| `ndarray` | 向量运算 | 阶段六 |

### 不引入的外部依赖

| 组件 | 原因 |
|------|------|
| iii-engine | 避免引入外部 native runtime，用 Rust 原生实现 |
| Qdrant/pgvector | 避免外部数据库依赖，用文件 + 内存索引 |
| Docker | 保持轻量部署 |

---

## 与现有 Claude Code 对齐文档的关系

本计划直接覆盖对齐文档中的以下待完成项：

| 对齐文档任务 | 本计划覆盖 |
|-------------|-----------|
| P2: Agent Memory 写入体验 — 考虑增加专门 Memory 工具 | 阶段四 MCP 工具 |
| P2: Agent Memory 写入体验 — 强化 prompt 规则 | 阶段三 Prompt 增强 |
| P2: Agent Memory 写入体验 — UI 展示长期记忆入口 | 阶段五 UI |
| Hooks 完整执行 | 阶段一 Hook 补全 |

同时为以下对齐任务提供基础：
- **P0: Agent Transcript / Resume** — 记忆系统中的 Episodic 层天然提供会话摘要，可作为 resume 上下文
- **P1: initialPrompt 端到端测试** — 记忆注入可作为 initialPrompt 的一部分

---

## 执行顺序与预估

| 顺序 | 阶段 | 预估工作量 | 优先级 |
|------|------|-----------|--------|
| 1 | 阶段一：Hook 补全 + 自动捕获 | 3-5 天 | P0 |
| 2 | 阶段二：记忆引擎核心 | 5-7 天 | P0 |
| 3 | 阶段三：Prompt 集成 | 2-3 天 | P1 |
| 4 | 阶段四：MCP 集成 | 2-3 天 | P1 |
| 5 | 阶段五：UI 集成 | 3-5 天 | P2 |
| 6 | 阶段六：高级特性 | 5-7 天 | P2 |

**总计**：约 20-30 天

---

## 验收标准

### 最小可用（阶段一 + 二完成后）

```powershell
# 1. 编译通过
cargo check -p openharness-core

# 2. Hook 全部接线
cargo test -p openharness-core hook_ -- --nocapture

# 3. 自动捕获工作
cargo test -p openharness-core memory_capture_ -- --nocapture

# 4. BM25 检索工作
cargo test -p openharness-core memory_bm25_ -- --nocapture

# 5. 端到端：启动桌面端，进行一次对话，验证记忆自动创建
pnpm run desktop:dev
# 对话后检查 .openharness/memory/ 目录是否有新的观测和摘要文件
```

### 完整可用（阶段三 + 四完成后）

```powershell
# 6. 记忆注入 prompt
cargo test -p openharness-core memory_inject_ -- --nocapture

# 7. MCP 工具可用
cargo test -p openharness-core memory_mcp_ -- --nocapture

# 8. 端到端：两次会话，第二次自动获得第一次的记忆上下文
# 第一次: "我用 JWT 做认证，放在 src/middleware/auth.ts"
# 第二次: "加个限流" → agent 应该已经知道认证的实现位置
```
