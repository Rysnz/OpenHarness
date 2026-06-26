# OpenHarness 统一执行计划

更新时间：2026-06-18

本文档合并了「Claude Code Agent 能力对齐」和「AgentMemory 记忆机制融入」两条工作线，形成一条无重复、有明确依赖链的统一执行路线。

## 执行状态（2026-06-18 更新）

| 阶段 | 状态 | 测试 |
|------|------|------|
| 一：Hook 接线 + 自动记忆捕获 | ✅ 完成 | 18 个 capture 测试 |
| 二：Inline mcpServers 动态连接 | ✅ 完成 | 编译通过 |
| 三：记忆引擎核心 | ✅ 完成 | 46 个 memory 测试 + 7 个 E2E |
| 四：Prompt 注入 + Memory 工具 | ✅ 完成 | 3 个工具已注册 |
| 五：权限硬化 + 端到端验收 | ✅ 完成 | 31 个权限测试 |
| 六：UI 集成 + 高级特性 | ✅ 完成 | 记忆查看器 UI |

**总计**：361 lib + 7 E2E = 368 个测试全部通过

### 关键产出

- `MemoryCaptureService` — SHA-256 去重 + 隐私过滤 + JSONL 持久化
- `MemoryTier` 4 层模型 — Working/Episodic/Semantic/Procedural
- `Bm25Index` — 含 CJK bigram 的 BM25 搜索
- `ConsolidationPipeline` — trait 化设计，可接入 LLM
- `MemorySearchService` — 高层搜索 API + token 预算 + prompt 格式化
- 3 个 Memory 工具 — MemorySearch / MemorySave / MemoryRecap
- 5 个 Tauri API — memory_search / save / sessions / stats / delete
- `MemoryScene` UI — 搜索 / 会话历史 / 统计 3 个标签页
- `resume_agent_task` — 从 Interrupted/Failed/Cancelled 恢复
- `AgentTranscriptStore` — 磁盘持久化
- `.claude/agents/reviewer.md` — 端到端样例

---

## 背景

### 两条源计划

| 来源 | 核心目标 | 文档 |
|------|---------|------|
| Claude Code 对齐 | 让 OpenHarness 的 agent 行为与 Claude Code 一致 | `docs/claude-code-agent-alignment-status.zh-CN.md` |
| AgentMemory 融入 | 引入 4 层记忆整合 + 混合检索 + 自动捕获 | `docs/agentmemory-integration-plan.zh-CN.md` |

### 合并依据

两条计划在以下点重叠或存在依赖：

| 重叠/依赖 | 说明 |
|-----------|------|
| **Hook 接线** | 对齐计划要求补全 hooks（P1），agentmemory 的自动捕获也依赖 hooks。做一次，两边受益。 |
| **Inline MCP** | 对齐计划 P0 要求 agent 动态连接 inline mcpServers，agentmemory 的 memory MCP 工具需要这个基础。 |
| **Transcript/Resume** | 对齐计划 P0 要求检查 transcript 完整性，agentmemory 的 Episodic 层天然产出会话摘要。 |
| **Memory 写入体验** | 对齐计划 P2 直接被 agentmemory 的 Prompt 注入 + MCP 工具覆盖。 |
| **Permission 硬化** | 对齐计划 P2 独有，agentmemory 不涉及，但 hook 执行路径共享。 |

---

## 现有系统盘点

### OpenHarness 已有能力

| 能力 | 位置 | 状态 |
|------|------|------|
| Hook 框架 | `AgentHookConfig` — 5 个生命周期点 | 框架完整，仅 2/5 接线 |
| MCP 基础设施 | `MCPServerManager` / `MCPToolAdapter` / rmcp 0.12.0 | 完整可用 |
| 文件记忆 | `.openharness/memory/` — memory.md + daily + topic | 可用，靠 agent 手动读写 |
| AI Memory Points | `ai_memories.json` 结构化 JSON | 可用，独立于文件记忆 |
| Scoped Agent Memory | `.claude/agent-memory/{agent}/MEMORY.md` | 可用，Claude Code 兼容 |
| Claude 规则加载 | CLAUDE.md / rules/*.md，@import 递归 | 可用 |
| 权限模式 | `permissionMode` 解析 | 解析完成，端到端未验证 |

### 差距总览

1. Hook 仅 2/5 接线（`before_agent_start` / `before_agent_finish`）
2. Inline MCP 只识别 key，不真正连接
3. 无自动记忆捕获，靠 agent 手动读写
4. 无语义检索，只有 grep
5. 无记忆整合管道（压缩、分层、衰减）
6. 权限模式未端到端验证
7. Hook shell 未接 PermissionEngine
8. Transcript/resume 未系统性检查

---

## 统一执行路线

```
阶段一 ─── Hook 接线补全 + 自动记忆捕获
            │  (对齐: Hooks P1 + 安全化 P1)  (AgentMemory: 阶段一)
            ▼
阶段二 ─── Inline mcpServers 动态连接与清理
            │  (对齐: MCP P0)  (AgentMemory: 前置依赖)
            ▼
阶段三 ─── 记忆引擎核心
            │  (AgentMemory: 阶段二)  (对齐: Transcript/Resume P0 的 Episodic 基础)
            ▼
阶段四 ─── Prompt 注入 + Memory MCP 工具
            │  (AgentMemory: 阶段三 + 四)  (对齐: Memory 写入体验 P2)
            ▼
阶段五 ─── 权限硬化 + 端到端验收
            │  (对齐: 权限 P1 + Hooks P1 + initialPrompt P1)
            ▼
阶段六 ─── UI 集成 + 高级特性
             (AgentMemory: 阶段五 + 六)  (对齐: 文档与 UI 收尾)
```

---

## 阶段一：Hook 接线补全 + 自动记忆捕获

**来源**：对齐计划 Hooks P1 + 安全化 P1 / AgentMemory 阶段一

**目标**：5 个生命周期点全部接线，同时接入自动记忆捕获。

### 1.1 补全 Round Executor 中的 Hook 调用点

**文件**：`src/crates/core/src/agentic/execution/round_executor.rs`

- [ ] 在模型请求前调用 `before_model_request` hooks
- [ ] 在工具调用前调用 `before_tool_call` hooks（支持 matcher 过滤）
- [ ] 在工具结果返回后调用 `after_tool_result` hooks
- [ ] 确保 hook 失败有明确的阻断/继续策略
- [ ] 为每个 hook 调用点注入上下文变量（tool_name, tool_input, tool_output 等）

### 1.2 Hook 安全化

**文件**：`src/crates/core/src/agentic/permissions/mod.rs`、round_executor.rs

- [ ] shell hook 不固定 `sh -c`，Windows 使用 PowerShell/cmd 兼容策略
- [ ] shell hook 走 PermissionEngine 权限评估
- [ ] shell hook 写入 audit 日志
- [ ] 明确 hook 失败时的阻断策略（对齐 Claude Code：hook 失败阻断后续执行）

### 1.3 实现 MemoryCaptureService

**新文件**：`src/crates/core/src/service/agent_memory/capture.rs`

```rust
pub struct MemoryCaptureService {
    workspace_root: PathBuf,
    dedup_cache: DashMap<String, Instant>,  // SHA-256 → 5min 窗口去重
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
- `privacy_filter()` — 过滤 `sk-*`, `ghp_*`, `Bearer *`, `-----BEGIN.*KEY-----`, `${SECRET}`, `<private>` 标签
- `extract_observation()` — 从原始工具调用中提取结构化观测
- `persist_observation()` — 写入 `.openharness/memory/observations/`

### 1.4 Hook 事件 → MemoryCaptureService 接线

**文件**：`src/crates/core/src/agentic/execution/execution_engine.rs`

```
before_agent_start  → capture_service.on_session_start(session_id, workspace)
after_tool_result   → capture_service.on_post_tool_use(tool_name, input, output)
before_agent_finish → capture_service.on_session_end(session_id)
```

### 验收

```powershell
cargo test -p openharness-core hook_before_tool_call -- --nocapture
cargo test -p openharness-core hook_after_tool_result -- --nocapture
cargo test -p openharness-core hook_matcher_filter -- --nocapture
cargo test -p openharness-core hook_shell_windows_compat -- --nocapture
cargo test -p openharness-core hook_permission_engine -- --nocapture
cargo test -p openharness-core memory_capture_dedup -- --nocapture
cargo test -p openharness-core memory_capture_privacy -- --nocapture
```

---

## 阶段二：Inline mcpServers 动态连接与清理

**来源**：对齐计划 MCP P0

**目标**：agent 声明的 inline MCP server 能真正连接，工具可用，结束后清理。

### 2.1 保留完整 Inline MCP Server Config

**文件**：`src/crates/core/src/agentic/agents/definition.rs`

- [ ] `mcp_servers` 字段从 `Vec<String>` 扩展为 `Vec<McpServerRef>`
- [ ] `McpServerRef` 支持两种形态：字符串引用（引用全局配置）和 inline map（完整连接配置）
- [ ] 序列化/反序列化兼容现有 YAML frontmatter 格式

```rust
pub enum McpServerRef {
    /// 引用全局 mcp_servers 配置中的 key
    Name(String),
    /// 完整 inline 配置
    Inline(McpServerConfig),
}
```

### 2.2 Agent 启动时动态连接

**文件**：`src/crates/core/src/agentic/execution/execution_engine.rs`

- [ ] 在 `before_agent_start` 之前，遍历 agent 声明的 `mcp_servers`
- [ ] 对 inline config 调用 `MCPServerManager::connect()` 建立连接
- [ ] 将动态 MCP tools 合并进 agent tool pool
- [ ] 工具名遵循 `mcp__{server_name}__{tool_name}` 命名

### 2.3 Agent 结束时清理

**文件**：`src/crates/core/src/agentic/execution/execution_engine.rs`

- [ ] 在 `before_agent_finish` 之后，断开 agent 动态创建的 MCP 连接
- [ ] 从 tool pool 中移除动态工具
- [ ] 清理连接资源

### 2.4 覆盖测试

- [ ] 字符串引用 MCP server → 工具可见
- [ ] Inline map MCP server → 动态连接 → 工具可用 → 结束后清理
- [ ] Agent 结束后动态工具不再出现在 tool pool

### 验收

```powershell
cargo test -p openharness-core inline_mcp_connect -- --nocapture
cargo test -p openharness-core inline_mcp_cleanup -- --nocapture
cargo test -p openharness-core mcp_tool_pool_merge -- --nocapture
```

---

## 阶段三：记忆引擎核心

**来源**：AgentMemory 阶段二 / 对齐计划 Transcript/Resume P0 的基础

**目标**：实现 4 层记忆整合、BM25 检索、会话摘要产出（同时服务 Transcript/Resume）。

### 3.1 定义记忆模型

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
    pub source_observations: Vec<String>,
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

### 3.2 实现记忆存储层

**新文件**：`src/crates/core/src/service/agent_memory/storage.rs`

**存储策略**：
- Working：`.openharness/memory/working/` — JSON lines，按会话分文件
- Episodic：`.openharness/memory/episodic/` — 每个会话一个 `.md` 摘要
- Semantic：`.openharness/memory/semantic/` — 结构化 JSON，按主题分文件
- Procedural：`.openharness/memory/procedural/` — 工作流模式 JSON

**迁移兼容**：
- 现有 `memory.md` 继续作为索引
- 现有 daily/topic 文件映射到 Episodic/Semantic 层
- 现有 `ai_memories.json` 映射到 Semantic 层

### 3.3 实现记忆整合管道

**新文件**：`src/crates/core/src/service/agent_memory/consolidation.rs`

```
会话结束时触发:
1. Working → Episodic: LLM 压缩本次会话原始观测为摘要
2. Episodic → Semantic: 从摘要中提取事实、决策、偏好
3. Semantic → Procedural: 从重复模式中提取工作流
4. 矛盾检测: 新事实与已有 Semantic 记忆冲突时标记/更新
5. 衰减计算: Ebbinghaus 曲线更新 decay_score
6. 淘汰: decay_score < 阈值且 access_count 低的记忆自动归档/删除
```

**对齐 Transcript/Resume**：Episodic 层产出的会话摘要同时可作为 resume 上下文。检查项：
- [ ] 子 agent 成功/失败/取消时 transcript 是否完整
- [ ] `transcript_ref` 是否稳定可读
- [ ] resume 后是否恢复 task 状态和上下文
- [ ] 补充失败路径测试

### 3.4 实现 BM25 检索

**新文件**：`src/crates/core/src/service/agent_memory/search.rs`

- [ ] 基于现有 `grep-searcher` / `grep-regex` 实现 BM25 评分
- [ ] 支持中英文分词（英文 stemming + 中文字符级 n-gram）
- [ ] 支持同义词扩展
- [ ] 结果按 session 去重（最多 3 条/session）
- [ ] 返回 top-K 结果，附带相关度分数

### 验收

```powershell
cargo test -p openharness-core memory_tier_model -- --nocapture
cargo test -p openharness-core memory_storage_migration -- --nocapture
cargo test -p openharness-core memory_consolidation -- --nocapture
cargo test -p openharness-core memory_bm25_search -- --nocapture
cargo test -p openharness-core memory_session_dedup -- --nocapture
cargo test -p openharness-core memory_decay -- --nocapture
cargo test -p openharness-core transcript_completeness -- --nocapture
cargo test -p openharness-core resume_context_restore -- --nocapture
```

### 新增依赖

| crate | 用途 |
|-------|------|
| `rust-stemmers` | 英文 stemming |
| `jieba-rs` | 中文分词 |

---

## 阶段四：Prompt 注入 + Memory MCP 工具

**来源**：AgentMemory 阶段三 + 四 / 对齐计划 Memory 写入体验 P2

**目标**：agent 自动获得相关记忆上下文，记忆可通过 MCP 工具操作。

### 4.1 增强 PromptBuilder

**文件**：`src/crates/core/src/agentic/agents/prompt_builder/prompt_builder_impl.rs`

- [ ] 修改 `build_workspace_agent_memory_prompt()`，从"列出所有文件"改为"检索最相关的记忆"
- [ ] 新增 `{SMART_MEMORY}` 占位符
- [ ] 实现 token 预算控制（默认 2000 tokens），超限按 importance 裁剪
- [ ] 记忆注入格式：

```
<memory_context>
## Project Memory (auto-captured)
- [Semantic] Auth uses JWT middleware in src/middleware/auth.ts (importance: 0.9, accessed: 5x)
- [Episodic] 2026-06-17: Fixed N+1 query in user service, added index on users.email
- [Procedural] When adding API endpoints: 1) define route 2) add handler 3) write tests

## Agent Memory (scoped)
- Per-agent MEMORY.md content
</memory_context>
```

### 4.2 会话开始时的记忆检索

**文件**：`src/crates/core/src/agentic/execution/execution_engine.rs`

在 `before_agent_start` 阶段：
1. 提取用户首条消息作为检索 query
2. 调用 `MemorySearchService::search(query, top_k=10, token_budget=2000)`
3. 将结果注入 `context_vars["smart_memory"]`

### 4.3 会话结束时的记忆沉淀

在 `before_agent_finish` 阶段：
1. 收集本次会话所有 captured observations
2. 触发 Consolidation Pipeline
3. 更新记忆索引
4. 写入会话摘要到 episodic 层

### 4.4 注册记忆 MCP 工具

**新文件**：`src/crates/core/src/service/agent_memory/mcp_tools.rs`

| 工具名 | 功能 |
|--------|------|
| `memory_smart_search` | 混合检索（BM25 + 向量） |
| `memory_save` | 手动保存一条记忆 |
| `memory_sessions` | 列出历史会话 |
| `memory_session_detail` | 查看某次会话详情 |
| `memory_forget` | 删除指定记忆 |
| `memory_recap` | 生成当前会话摘要 |

**注册方式**：在 `src/crates/core/src/agentic/tools/registry.rs` 中自动注入，对所有 agent 可见。

### 4.5 Agent Prompt 与使用说明优化

**文件**：prompt_builder_impl.rs、各 agent prompt 文件

- [ ] Task prompt 对齐 Claude Code 的 fork/subagent 使用说明
- [ ] 明确什么时候 fork，什么时候启动 fresh subagent
- [ ] 明确不要用 Task 做简单文件读取、精确 grep 等轻任务
- [ ] 展示 agent 的 tools、memory、background、MCP 信息

### 验收

```powershell
cargo test -p openharness-core memory_prompt_inject -- --nocapture
cargo test -p openharness-core memory_token_budget -- --nocapture
cargo test -p openharness-core memory_mcp_tools -- --nocapture
cargo test -p openharness-core memory_consolidation_e2e -- --nocapture

# 端到端：两次会话，第二次自动获得第一次的记忆上下文
# 第一次: "我用 JWT 做认证，放在 src/middleware/auth.ts"
# 第二次: "加个限流" → agent 应该已经知道认证的实现位置
```

---

## 阶段五：权限硬化 + 端到端验收

**来源**：对齐计划 Permission P1 + initialPrompt P1 + 端到端验收

**目标**：权限模式端到端验证，构造完整样例，系统性验收。

### 5.1 子 Agent 权限隔离测试

- [ ] 覆盖 `ask` — 所有命令都确认
- [ ] 覆盖 `acceptEdits` — 自动通过低风险，阻止高风险
- [ ] 覆盖 `dontAsk` / `bypassPermissions` — 无需确认
- [ ] 覆盖 Bash、Write、Edit、Delete 类工具
- [ ] 修复 UI 与 runtime 不一致

### 5.2 Agent-specific MCP 工具列表准确性

- [ ] 动态 MCP 连接后刷新工具池
- [ ] Task description 中准确展示 agent 实际工具
- [ ] 避免模型误以为某些 MCP 工具可用或不可用

### 5.3 `initialPrompt` / Fork 端到端测试

- [ ] 验证进入 execution 的 message 顺序：system prompt → parent context → fork task wrapper → initialPrompt
- [ ] 验证 `initialPrompt` 不污染父会话
- [ ] 记忆注入作为 initialPrompt 的一部分验证

### 5.4 构造端到端样例

创建 `.claude/agents/reviewer.md`：

```yaml
---
description: Review code changes
tools: "*"
disallowedTools:
  - Bash
permissionMode: acceptEdits
maxTurns: 7
model: inherit
memory: project
initialPrompt: Read repository rules before starting.
background: true
mcpServers:
  - github
---
Review carefully.
```

### 5.5 系统性验收

```powershell
# 编译
cargo check -p openharness-core

# 全量 agent 测试
cargo test -p openharness-core agentic -- --nocapture

# 权限测试
cargo test -p openharness-core permission_ -- --nocapture

# Hook 测试
cargo test -p openharness-core hook_ -- --nocapture

# 记忆测试
cargo test -p openharness-core memory_ -- --nocapture

# MCP 测试
cargo test -p openharness-core mcp_ -- --nocapture

# Transcript/Resume
cargo test -p openharness-core transcript_ -- --nocapture
cargo test -p openharness-core resume_ -- --nocapture

# 端到端桌面端
pnpm run desktop:dev
# 验证：
# 1. 指定 subagent 的 Task 调用
# 2. 省略 subagent_type 的 fork 调用
# 3. background agent
# 4. resume / transcript 查看
# 5. 记忆自动注入
# 6. memory MCP 工具可用
```

---

## 阶段六：UI 集成 + 高级特性

**来源**：AgentMemory 阶段五 + 六 / 对齐计划 UI 收尾

### 6.1 记忆查看器

**新页面**：`src/web-ui/src/app/scenes/memory/`

- 时间线视图：按会话展示记忆积累
- 搜索界面：关键词 + BM25 检索
- 记忆详情：来源观测、关联文件、衰减状态
- 每个 agent 的独立记忆空间入口

### 6.2 记忆管理

- 手动编辑/删除记忆
- 记忆重要度调整
- 记忆导出/导入

### 6.3 后端 API

**新文件**：`src/crates/core/src/service/agent_memory/api.rs`

- `GET /api/memory/search?q=...`
- `GET /api/memory/sessions`
- `GET /api/memory/sessions/{id}`
- `DELETE /api/memory/{id}`
- `WS /api/memory/stream` — 实时更新推送

### 6.4 文档与配置 UI 收尾

- [ ] 更新开发文档
- [ ] 在 agent 配置 UI 中展示 Claude Code 兼容字段
- [ ] 避免用户直接编辑 md frontmatter

### 6.5 向量嵌入（可选）

- 集成本地 ONNX 推理（`all-MiniLM-L6-v2`）或通过 AI client 调用嵌入 API
- 余弦相似度 + RRF 融合 BM25 和向量分数

### 6.6 知识图谱（可选）

- 从 Semantic 记忆中提取实体和关系
- BFS 遍历图谱进行关联检索
- 前端可视化

---

## 依赖变更总览

### 新增 Rust 依赖

| crate | 用途 | 阶段 |
|-------|------|------|
| `rust-stemmers` | 英文 stemming | 三 |
| `jieba-rs` | 中文分词 | 三 |
| `ort` (可选) | ONNX Runtime | 六 |
| `ndarray` | 向量运算 | 六 |

### 不引入的外部依赖

| 组件 | 原因 |
|------|------|
| iii-engine | 避免外部 native runtime |
| Qdrant/pgvector | 避免外部数据库 |
| Docker | 保持轻量部署 |

---

## 时间线总览

| 阶段 | 内容 | 预估 | 优先级 | 来源 |
|------|------|------|--------|------|
| 一 | Hook 接线 + 安全化 + 自动捕获 | 3-5 天 | P0 | 对齐 + AgentMemory |
| 二 | Inline mcpServers 动态连接 | 2-3 天 | P0 | 对齐 |
| 三 | 记忆引擎核心（4 层 + BM25 + Transcript） | 5-7 天 | P0 | AgentMemory + 对齐 |
| 四 | Prompt 注入 + Memory MCP 工具 | 3-4 天 | P1 | AgentMemory + 对齐 |
| 五 | 权限硬化 + 端到端验收 | 3-5 天 | P1 | 对齐 |
| 六 | UI + 高级特性 | 5-7 天 | P2 | AgentMemory + 对齐 |

**总计**：约 21-31 天

---

## 统一验收标准

### 最小可用（阶段一 + 二 + 三完成后）

```powershell
cargo check -p openharness-core
cargo test -p openharness-core hook_ -- --nocapture
cargo test -p openharness-core inline_mcp_ -- --nocapture
cargo test -p openharness-core memory_ -- --nocapture
pnpm run desktop:dev
# 验证：对话后 .openharness/memory/ 自动产生观测和摘要
```

### 完整可用（阶段四 + 五完成后）

```powershell
cargo test -p openharness-core agentic -- --nocapture
pnpm run desktop:dev
# 验证：
# 1. 两次会话，第二次自动获得第一次的记忆上下文
# 2. memory MCP 工具可用
# 3. 权限模式按预期工作
# 4. .claude/agents/reviewer.md 端到端运行
# 5. fork / background / resume / transcript 正常
```
