# Claude Code Agent 能力对齐进度

更新时间：2026-06-18

本文档记录 OpenHarness 当前对齐 Claude Code agent 能力的已完成进度、剩余缺口和后续执行计划。优先级以"是否直接影响 agent 实际工作能力"为准。

## 当前状态

OpenHarness 的 agent 能力已从"部分借鉴 Claude Code"推进到"核心行为基本对齐"。2026-06-18 统一执行计划完成了 Hook 全部接线、Inline MCP 动态连接、4 层记忆引擎、权限端到端验证、Task prompt 优化、Transcript 持久化等工作。

最近一次核心验证结果：

```powershell
cargo check -p openharness-core
```

已通过。

## 已完成

### 1. Claude Code 记忆体系

- 支持读取项目级与本地 Claude 规则文件：
  - `CLAUDE.md`
  - `.claude/CLAUDE.md`
  - `.claude/rules/**/*.md`
  - `CLAUDE.local.md`
- 支持 `@path` import：
  - 相对路径
  - `@~/path`
  - 递归导入深度限制
  - 跳过代码块和注释中的 import
- 支持 per-agent 记忆：
  - `memory: user`
  - `memory: project`
  - `memory: local`
- 对应记忆文件会被创建并注入 agent prompt：
  - `~/.claude/agent-memory/<agent>/MEMORY.md`
  - `<workspace>/.claude/agent-memory/<agent>/MEMORY.md`
  - `<workspace>/.claude/agent-memory-local/<agent>/MEMORY.md`

### 2. Custom Agent Frontmatter 兼容

已兼容 Claude Code 常用 camelCase 字段：

- `permissionMode`
- `disallowedTools`
- `maxTurns`
- `mcpServers`
- `initialPrompt`
- `background`

已支持：

- `tools: "*"`
- `model: inherit`
- `memory: user/project/local`
- `mcpServers` 字符串列表
- `mcpServers` inline map 的 server key 识别

### 3. Task / Subagent 能力

- Task 工具已接入 MiniApp 初始化工具。
- `maxTurns/max_turns` 现在真正限制 agent 执行轮数。
- 省略 `subagent_type` 时，Task 会 fork 当前 agent。
- fork 当前 agent 时会真正继承父会话上下文。
- fork 继承时会过滤父 system prompt，避免重复系统提示。
- `initialPrompt` 会 prepend 到子任务 prompt。
- `background: true` 会让该 agent 默认后台运行。

### 4. Hooks 对齐

已支持 Claude Code 风格 hooks 结构：

- `SessionStart`
- `SubagentStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`
- `StopFailure`
- `SubagentStop`

已支持 matcher：

```yaml
hooks:
  PreToolUse:
    - matcher: Write|Edit
      hooks:
        - type: command
          command: echo pre-tool
```

当前已映射到 OpenHarness 生命周期点：

- `before_agent_start`
- `before_model_request`
- `before_tool_call`
- `after_tool_result`
- `before_agent_finish`

### 5. 权限与命令执行

已增强 permission mode 解析：

- `plan`
- `acceptEdits`
- `dontAsk`
- `bypassPermissions`

已完成部分命令环境与流式输出相关修复，但权限链路仍需继续做端到端核验。

## 已验证测试

已跑过的核心 targeted tests 包括：

```powershell
cargo test -p openharness-core scoped_agent_memory -- --nocapture
cargo test -p openharness-core parses_claude_code_frontmatter_aliases -- --nocapture
cargo test -p openharness-core effective_max_rounds_respects_agent_limit -- --nocapture
cargo test -p openharness-core validates_task_control_actions_without_spawn_fields -- --nocapture
cargo test -p openharness-core forked_subagent_messages -- --nocapture
cargo test -p openharness-core inherit_parent_context_flag -- --nocapture
cargo test -p openharness-core inherited_model -- --nocapture
cargo test -p openharness-core inherit_model_id -- --nocapture
cargo check -p openharness-core
```

## 待完成任务

### ~~P0: Inline `mcpServers` 动态连接与清理~~ ✅ 已完成（2026-06-18）

- `AgentDefinition` 新增 `inline_mcp_servers: HashMap<String, serde_json::Value>`
- `parse_mcp_server_configs()` 解析 YAML 中的 inline 配置
- `MCPServerManager::connect_transient()` 不持久化配置，直接启动
- `MCPServerManager::disconnect_transient()` 停止 + 注销
- 执行引擎在 agent 启动时连接、结束时断开

### ~~P0: Agent Transcript / Resume 对齐~~ ✅ 部分完成（2026-06-18）

- `AgentTranscriptStore` 支持磁盘持久化（`with_persistence` / `load_from_disk` / `persist_to_disk`）
- `resume_agent_task` 已实现：从 Interrupted/Failed/Cancelled 状态恢复，创建新任务复用原 config
- 会话级 transcript 已有 `export_session_transcript()` 持久化

### ~~P1: Agent-specific MCP 工具列表与提示准确性~~ ✅ 已完成（2026-06-18）

- Task 工具 prompt 新增 "Fork vs Fresh Subagent" 和 "Agent Information" 段
- 展示 agent 的 tools、disallowedTools、memory、background、mcpServers、permissionMode
- `start_server` 内部调用 `register_mcp_tools` 自动注册

### ~~P1: Permission Mode 运行时一致性~~ ✅ 已完成（2026-06-18）

- +15 个端到端权限测试覆盖 ask/acceptEdits/dontAsk/deny
- 覆盖 Bash/Write/Edit/Delete 工具
- 验证 global mode 与 agent mode 的优先级关系
- deny rule 可覆盖 agent allow mode

### P1: Hooks 安全化与完整执行

当前状态：

- hooks 结构解析和生命周期映射已完成。
- `command` 类型 hook 可进入执行路径。
- `prompt/http/agent` 类型还偏占位。

任务：

- shell hook 不固定 `sh -c`，Windows 使用 PowerShell/cmd 兼容策略。
- shell hook 走 PermissionEngine。
- shell hook 写入 audit。
- 明确 hook 失败时是否阻断流程。
- 根据 Claude Code 行为补齐 `prompt/http/agent` hook 的实际执行策略。

### P1: `initialPrompt` / Fork 端到端测试

当前状态：

- 字段已接入。
- fork 已继承父上下文。

任务：

- 建立端到端测试，验证进入 execution 的 message 顺序：
  - system prompt
  - parent context
  - fork task wrapper
  - initialPrompt
- 验证 `initialPrompt` 不污染父会话。

### ~~P2: Agent Memory 写入体验~~ ✅ 已完成（2026-06-18）

- 3 个 Memory 工具已注册：MemorySearch / MemorySave / MemoryRecap
- 4 层记忆引擎：Working → Episodic → Semantic → Procedural
- BM25 搜索（含 CJK bigram）
- 会话结束自动 consolidation
- 记忆自动注入 agent prompt（`<memory_context>` XML）
- Memory UI 场景：搜索 / 会话历史 / 统计

### ~~P2: Agent Prompt 与使用说明优化~~ ✅ 已完成（2026-06-18）

- Task 工具 prompt 新增 "Fork vs Fresh Subagent" 说明
- 新增 "Agent Information" 段展示 tools/memory/background/mcpServers/permissionMode
- 明确什么时候 fork vs fresh subagent
- 明确不要用 Task 做简单文件读取等轻任务

## 后续执行计划

### 阶段一：补最影响能力的 MCP 与 Resume

1. 审查 OpenHarness MCP service
   - 查找现有 MCP manager 的 connect/register/cleanup API。
   - 判断是否能直接接入 agent 生命周期。
   - 输出接口改造点。

2. 实现 inline `mcpServers`
   - 数据结构保留完整 config。
   - agent 启动时动态连接。
   - 合并 MCP tools。
   - agent 结束时清理。
   - 增加测试。

3. 审查 transcript/resume
   - 检查 AgentTaskSupervisor。
   - 检查 SessionManager。
   - 检查 persistence。
   - 补齐失败/取消/后台完成路径。

### 阶段二：权限与 Hooks 硬化

4. 子 agent 权限隔离测试
   - 覆盖 `ask / acceptEdits / dontAsk`。
   - 覆盖 Bash、Write、Edit、Delete。
   - 修复 UI 与 runtime 不一致。

5. Hook shell 执行安全化
   - Windows shell 兼容。
   - 接 PermissionEngine。
   - 接 audit。
   - 决定并实现失败阻断策略。

### 阶段三：完整验收与体验优化

6. 构造 `.claude/agents/reviewer.md` 端到端样例

覆盖字段：

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

7. 端到端验证
   - 跑 `cargo test -p openharness-core agentic`。
   - 启动桌面端。
   - 实际调用 Task：
     - 指定 subagent
     - 省略 subagent_type fork 当前 agent
     - background agent
     - resume / transcript 查看

8. 文档与 UI 收尾
   - 更新开发文档。
   - 在 agent 配置 UI 中展示 Claude Code 兼容字段。
   - 避免用户直接编辑容易出错的 md frontmatter。

## 建议下一步

2026-06-18 统一执行计划已完成大部分对齐工作。剩余事项：

1. **Consolidation 接入真实 LLM** — 当前 NoOpLlmProvider 只生成模板摘要
2. **向量嵌入**（P2 可选）— BM25 + 向量混合检索
3. **桌面端端到端验证** — 实际运行验证
4. **Hook prompt/http/agent 类型实现**

原因：

- 它直接决定自定义 agent 是否能携带自己的工具能力。
- 它是 Claude Code agent 能力里很核心的一块。
- 当前只识别 key，不真正连接，属于“看起来支持但实际能力缺失”的高风险点。
