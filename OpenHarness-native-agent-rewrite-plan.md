# OpenHarness 原生 Agent 能力增强重写方案

## 1. 目标和硬边界

本方案的目标是增强 OpenHarness 后端，使其具备真实可用的完整 Agent 能力，包括原生多 Agent 运行时、后台任务、可恢复执行、权限治理、工具隔离、worktree 隔离、MCP/Skills/Hooks 隔离、变更审查和多 Agent 协作。

所有改动必须服务于真实能力，不允许用模拟、空壳、伪状态或 sidecar 充数。

硬边界如下：

- 不接入 `claude-code-new` 的 Bun/TypeScript runtime。
- 不把 OpenHarness 或 Claude Code 作为 sidecar 运行时。
- 不用外部 CLI 代替 Agent runtime。
- 不允许 fake background task，后台任务必须真实执行。
- 不允许 fake subagent，子 Agent 必须有独立定义、上下文、工具视图和 transcript。
- 不允许 fake tool result，工具必须真实执行、真实失败或真实被权限系统阻断。
- 不允许 fake worktree，声明 `worktree` 隔离时必须真实创建 worktree，失败必须显式报错。
- 不允许 fake permission，权限判断必须阻断或暂停真实执行。
- 不允许 UI/API 宣称未实现能力已可用。

必要例外：

- Shell、MCP stdio server、LSP server、git 命令兜底可以作为具体工具语义启动外部进程。
- 这些外部进程只能是工具执行对象，不能成为 Agent runtime 本身。

## 2. 现状结论

### 2.1 OpenHarness 已有基础

OpenHarness 已有较完整的 Agent 主干：

- `src/crates/core/src/agentic/execution/execution_engine.rs`
  - `ExecutionEngine`
  - `execute_dialog_turn`
  - context compression
  - microcompact
  - model round loop
- `src/crates/core/src/agentic/execution/round_executor.rs`
  - model round 执行
  - tool call 收集
  - tool execution 回填
  - cancellation 检查
- `src/crates/core/src/agentic/tools/framework.rs`
  - `Tool` trait
  - `ToolUseContext`
  - `needs_permissions`
  - `is_concurrency_safe`
  - `supports_streaming`
- `src/crates/core/src/agentic/tools/pipeline/tool_pipeline.rs`
  - tool 并发/串行分批
  - `execute_tools`
  - `cancel_tool`
  - `confirm_tool`
- `src/crates/core/src/agentic/agents/registry.rs`
  - builtin agents
  - custom subagents
  - per-agent tool list
  - custom subagent loader
- `src/crates/core/src/agentic/tools/implementations/task_tool.rs`
  - 当前 TaskTool 子 Agent 入口
- `src/crates/core/src/agentic/coordination/coordinator.rs`
  - 当前 `execute_subagent`

这些模块应作为原生重写的主干，不应被 OpenHarness 的 MVP turn loop 替换。

### 2.2 OpenHarness 主要缺口

当前缺口集中在完整 Agent runtime 层：

- 子 Agent 执行偏一次性，执行后清理，不适合后台、恢复和审计。
- 没有 native `AgentTaskSupervisor`。
- 没有后台 Agent task 生命周期。
- 没有 Agent mailbox。
- 没有完整 parent/child task 关系。
- 没有独立 worktree isolation。
- 权限系统缺少统一策略、审批队列和审计链。
- Shell 安全偏基础，不能覆盖复杂绕过。
- MCP/Skills/Hooks 未按 Agent task 隔离到完整程度。
- 子 Agent diff/patch 缺少统一审查和合并模型。
- 多 Agent team/swarm 协作缺少 runtime 级支持。

### 2.3 claude-code-new 的作用

`claude-code-new` 只作为能力规格参考和测试样本来源，不能移植运行时。

可参考能力：

- AgentTool 输入字段。
- `run_in_background` 语义。
- `fork_context` 语义。
- worktree isolation 语义。
- per-agent MCP/skills/hooks。
- permission rule 设计。
- streaming tool execution。

不可采用：

- Bun/TypeScript runtime。
- sidecar/CLI delegation。
- 依赖外部进程承载 Agent runtime。

### 2.4 OpenHarness 的作用

OpenHarness 不能提供完整 Agent 能力，但有可借鉴组件：

- `agent_turn.rs`
  - 可借鉴 task registry 的状态、事件、取消、恢复设计。
- `tool_call_adapter.rs`
  - 可借鉴 OpenAI/Anthropic/Gemini/OpenAI-compatible 工具 schema 和响应解析测试。
- `approval_commands.rs`
  - 可借鉴统一审批中心。
- `approval_policy_store.rs`
  - 可借鉴策略版本、导入导出、签名校验。
- `audit_store.rs`
  - 可借鉴命令/权限审计。
- `mcp/server_manager.rs`
  - 可借鉴 MCP tool cache、namespaced tool、remote reconnect。
- `agent_turn_store.rs`
  - 可借鉴 diff 持久化、accept/reject 状态。

不可采用：

- `subagent_commands.rs`，当前基本是空壳。
- `agent_runtime.rs` 中的 sidecar runtime 语义。
- `command_guard.rs` 作为最终 shell 安全实现。
- `command_exec.rs` 作为最终 Agent shell 主体。
- OpenHarness 的单 turn loop 替换 OpenHarness `ExecutionEngine`。

## 3. 总体架构

目标架构分为七层：

1. Agent Definition Layer
   - builtin agent
   - custom agent markdown
   - frontmatter schema
   - mode/model/tools/permissions/mcp/skills/hooks/isolation

2. Native Agent Runtime Layer
   - `AgentTaskSupervisor`
   - `AgentTaskRegistry`
   - `AgentTask`
   - `AgentMailbox`
   - `AgentTranscriptStore`
   - `WorkspaceBinding`

3. Execution Layer
   - 复用 OpenHarness `ExecutionEngine`
   - 复用 `RoundExecutor`
   - 复用 context compression 和 microcompact

4. Tool Layer
   - 复用 OpenHarness `Tool` trait
   - 复用 `ToolPipeline`
   - 增强 streaming events、permission gate、task attribution

5. Governance Layer
   - permission engine
   - approval queue
   - audit store
   - shell risk analyzer
   - policy versioning

6. Isolation Layer
   - shared workspace
   - git worktree
   - scratch workspace
   - per-agent MCP/Skills/Hooks visibility

7. Review and Collaboration Layer
   - patch store
   - diff accept/reject
   - team/swarm mailbox
   - parent/child result synthesis

## 4. 目录规划

建议新增或调整以下目录：

```text
src/crates/core/src/agentic/
  runtime/
    mod.rs
    agent_task.rs
    agent_task_registry.rs
    agent_supervisor.rs
    agent_mailbox.rs
    agent_transcript.rs
    workspace_binding.rs
    task_events.rs
    recovery.rs
    team.rs

  permissions/
    mod.rs
    policy.rs
    rule.rs
    decision.rs
    approval_queue.rs
    audit.rs
    policy_store.rs

  security/
    mod.rs
    shell/
      mod.rs
      analyzer.rs
      ast.rs
      dialect.rs
      risk.rs
      rules.rs

  patches/
    mod.rs
    patch_store.rs
    diff_summary.rs
    review_state.rs
```

已有模块改造：

```text
src/crates/core/src/agentic/tools/implementations/task_tool.rs
src/crates/core/src/agentic/coordination/coordinator.rs
src/crates/core/src/agentic/agents/registry.rs
src/crates/core/src/agentic/execution/execution_engine.rs
src/crates/core/src/agentic/execution/round_executor.rs
src/crates/core/src/agentic/tools/pipeline/tool_pipeline.rs
src/crates/core/src/agentic/tools/framework.rs
```

## 5. 阶段 0：冻结边界和基线

### 5.1 要做什么

1. 新增设计文档：
   - `docs/native-agent-runtime/design.md`
   - `docs/native-agent-runtime/capability-matrix.md`

2. 写能力矩阵：
   - OpenHarness 当前已有能力。
   - claude-code-new 参考能力。
   - OpenHarness 可借鉴组件。
   - OpenHarness 需要重写的缺口。

3. 跑 OpenHarness 当前基线：
   - 普通对话。
   - 工具调用。
   - TaskTool 子 Agent。
   - Bash tool。
   - MCP tool。
   - context compression。
   - cancel。

4. 记录当前行为：
   - 子 Agent 是否清理 session。
   - tool confirmation 行为。
   - tool cancellation 行为。
   - transcript 是否可追踪。

### 5.2 完成标准

- 有明确能力矩阵。
- 所有未来阶段都能对照矩阵验收。
- 没有实现任何 mock 或空壳 API。

### 5.3 禁止事项

- 禁止新增只返回假数据的 API。
- 禁止新增 UI 可见但无真实执行链路的功能。

## 6. 阶段 1：Agent Definition 补齐

### 6.1 要做什么

1. 扩展 `CustomSubagent`：
   - `mode`
   - `model`
   - `temperature`
   - `max_turns`
   - `permission_mode`
   - `allowed_tools`
   - `disallowed_tools`
   - `mcp_servers`
   - `skills`
   - `memory`
   - `hooks`
   - `isolation`
   - `cwd`

2. 扩展 markdown frontmatter parser。

3. 兼容旧 agent 文件：
   - `.OpenHarness/agents`
   - `.claude/agents`
   - `.cursor/agents`
   - `.codex/agents`

4. 新增统一结构：

```rust
pub struct AgentDefinition {
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub mode: AgentMode,
    pub model: Option<String>,
    pub temperature: Option<f32>,
    pub max_turns: Option<u32>,
    pub permission_mode: PermissionMode,
    pub allowed_tools: Vec<String>,
    pub disallowed_tools: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub skills: Vec<String>,
    pub memory: AgentMemoryConfig,
    pub hooks: AgentHookConfig,
    pub isolation: WorkspaceIsolation,
    pub cwd: Option<PathBuf>,
}
```

5. 修改 `AgentRegistry`：
   - builtin agents 和 custom agents 都返回 `AgentDefinition`。
   - tool list 从 `AgentDefinition` 计算。
   - model 选择从 `AgentDefinition` 读取。

### 6.2 测试

1. 解析 OpenHarness 旧格式 agent。
2. 解析 Claude Code 风格 agent。
3. 解析 OpenCode 风格 agent。
4. 缺字段时使用安全默认值。
5. `allowed_tools` 和 `disallowed_tools` 冲突时 deny 优先。

### 6.3 完成标准

- Agent 定义完整可解析。
- 旧 agent 文件不破。
- 尚未实现的字段不得在运行时伪装生效。

## 7. 阶段 2：Native Agent Runtime 骨架

### 7.1 要做什么

1. 新增 `agent_task.rs`。

核心类型：

```rust
pub struct AgentTaskId(String);

pub enum AgentTaskStatus {
    Queued,
    Running,
    WaitingApproval,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

pub enum AgentTaskKind {
    Foreground,
    Child,
    Background,
    TeamMember,
}

pub struct AgentTaskConfig {
    pub agent_name: String,
    pub prompt: String,
    pub parent_task_id: Option<AgentTaskId>,
    pub session_id: Option<String>,
    pub workspace_binding: WorkspaceBinding,
    pub fork_context: ForkContextMode,
    pub max_turns: Option<u32>,
    pub allowed_tools: Vec<String>,
    pub model: Option<String>,
}
```

2. 新增 `agent_task_registry.rs`。

必须真实支持：

- create task
- start task
- cancel task
- query task
- list task
- push event
- recover interrupted task
- persist snapshot

3. 新增 `agent_supervisor.rs`。

职责：

- 控制并发。
- 调度 foreground/background/child task。
- 管理 parent/child 关系。
- 管理 task cancellation。
- 管理 task recovery。

4. 新增 `agent_transcript.rs`。

必须记录：

- initial prompt
- inherited context
- model messages
- tool calls
- tool results
- permission decisions
- patch records
- final result

5. 新增 `task_events.rs`。

事件必须结构化：

```rust
pub enum AgentTaskEventKind {
    TaskStarted,
    ModelRequestStarted,
    TokenDelta,
    ToolCallQueued,
    ToolCallStarted,
    ToolCallWaitingApproval,
    ToolCallCompleted,
    ToolCallFailed,
    PatchReady,
    TaskSucceeded,
    TaskFailed,
    TaskCancelled,
}
```

### 7.2 测试

1. fake future 不够，必须至少有一个真实 no-op Agent execution path。
2. 可以用测试模型 adapter 返回固定真实响应，但必须走真实 execution pipeline。
3. task cancel 后状态真实变更。
4. transcript 写入后可读取。
5. interrupted task 可被列出。

### 7.3 完成标准

- Runtime 可创建真实 Agent task。
- Task event 和 transcript 都来自真实执行链路。
- 没有只生成 id 不执行的假后台。

## 8. 阶段 3：ExecutionEngine 接入 AgentTask

### 8.1 要做什么

1. 给 `ExecutionEngine` 增加 task context：

```rust
pub struct AgentExecutionContext {
    pub task_id: AgentTaskId,
    pub parent_task_id: Option<AgentTaskId>,
    pub workspace_binding: WorkspaceBinding,
    pub permission_scope: PermissionScope,
    pub transcript_writer: TranscriptWriter,
    pub event_sink: AgentTaskEventSink,
}
```

2. 修改 `execute_dialog_turn` 内部：
   - 每轮模型请求写入 transcript。
   - 每轮 token/stream event 写入 task event。
   - 每个 tool call 绑定 task id。
   - 每个 tool result 写入 transcript。

3. 修改 `RoundExecutor`：
   - 接收 task event sink。
   - tool execution 前发送 `ToolCallQueued`。
   - tool execution 后发送 completed/failed/cancelled。

4. 保持旧 API：
   - 旧普通对话路径可不传 task context。
   - AgentTool 路径必须传 task context。

### 8.2 测试

1. 一次真实模型 round 产生 transcript。
2. 一次工具调用产生 task event。
3. cancelled token 会停止后续 tool execution。

### 8.3 完成标准

- Agent task 不再只是外层状态机。
- Agent task 的事件和 transcript 能追到 `ExecutionEngine` 内部真实行为。

## 9. 阶段 4：TaskTool 升级为 AgentTool

### 9.1 要做什么

1. 修改 `task_tool.rs` 的 tool schema。

输入字段：

```json
{
  "description": "string",
  "prompt": "string",
  "subagent_type": "string?",
  "model": "string?",
  "run_in_background": "boolean?",
  "name": "string?",
  "team_name": "string?",
  "mode": "string?",
  "isolation": "none|worktree|scratch?",
  "cwd": "string?",
  "allowed_tools": "string[]?",
  "fork_context": "boolean?",
  "max_turns": "number?"
}
```

2. `run_in_background=false`：
   - 创建 child task。
   - 等待真实完成。
   - 返回真实 summary。
   - 返回 transcript ref。

3. `run_in_background=true`：
   - 创建 background task。
   - 立即返回 task id。
   - task 必须真实继续运行。

4. `subagent_type`：
   - 从 `AgentRegistry` 读取真实 `AgentDefinition`。
   - 不存在时报错。

5. `allowed_tools`：
   - 和 agent definition tools 求交集。
   - deny 规则优先。

6. `fork_context`：
   - 从父 task/session 提取上下文。
   - 写入 child transcript。

7. 移除或绕过旧 `execute_subagent` 中执行完即清理 session 的行为。

### 9.2 测试

1. 同步 child Agent 真实执行。
2. 后台 child Agent 真实执行。
3. 查询后台 task status。
4. 取消后台 task。
5. 未知 subagent_type 报错。
6. 不允许工具被权限阻断。
7. fork_context 后 transcript 含继承记录。

### 9.3 完成标准

- TaskTool 具备 AgentTool 真实能力。
- 后台不是假 id。
- 子 Agent 不是一次性黑盒。

## 10. 阶段 5：Coordinator 改造

### 10.1 要做什么

1. 修改 `coordinator.rs`。

新增方法：

```rust
spawn_agent_task(config) -> AgentTaskSnapshot
wait_agent_task(task_id) -> AgentTaskResult
cancel_agent_task(task_id) -> AgentTaskSnapshot
resume_agent_task(task_id) -> AgentTaskSnapshot
list_agent_tasks(filter) -> Vec<AgentTaskSnapshot>
```

2. 旧 `execute_subagent` 改成 wrapper：
   - 构造 `AgentTaskConfig`。
   - 调用 `AgentTaskSupervisor`。
   - 等待 child result。

3. 增加 parent/child task 关系。

4. 增加 event subscription：
   - 父 Agent 可以看到子 Agent 进展摘要。
   - UI 可以订阅 task events。

### 10.2 测试

1. 父 Agent 创建子 Agent。
2. 父 Agent 等待子 Agent。
3. 子 Agent 失败后父 Agent 获得结构化失败。
4. 子 Agent 被取消后 transcript 保留。

### 10.3 完成标准

- Coordinator 不再负责临时 session 清理式子 Agent。
- Coordinator 成为 Agent task 的协调入口。

## 11. 阶段 6：Workspace 和 Worktree Isolation

### 11.1 要做什么

1. 新增 `workspace_binding.rs`。

```rust
pub enum WorkspaceIsolation {
    None,
    GitWorktree,
    Scratch,
}

pub struct WorkspaceBinding {
    pub isolation: WorkspaceIsolation,
    pub root: PathBuf,
    pub working_dir: PathBuf,
    pub branch_name: Option<String>,
    pub worktree_path: Option<PathBuf>,
    pub cleanup_policy: CleanupPolicy,
}
```

2. `None`：
   - 使用当前 workspace。

3. `GitWorktree`：
   - 检查 workspace 是否 git repo。
   - 创建唯一 branch/worktree。
   - task 所有文件工具和 shell cwd 指向 worktree。
   - 记录 worktree 元数据。

4. `Scratch`：
   - 创建临时副本或空 workspace。
   - 明确限制不能自动 merge。

5. 完成后生成 worktree summary：
   - branch
   - changed files
   - diff stat
   - merge risk

6. 不允许静默降级。

如果 `isolation=worktree` 创建失败，必须返回真实错误。

### 11.2 测试

1. git repo 下创建 worktree。
2. 非 git repo 下 worktree 报错。
3. branch 冲突自动生成唯一名。
4. task shell cwd 真实指向 worktree。
5. 文件写入真实发生在 worktree。

### 11.3 完成标准

- 并发后台 Agent 默认可以互不踩文件。
- worktree 是真实 git worktree。

## 12. 阶段 7：权限引擎

### 12.1 要做什么

1. 新增 `permissions` 模块。

核心类型：

```rust
pub enum PermissionDecision {
    Allow,
    Ask,
    Deny,
}

pub struct PermissionRequest {
    pub task_id: AgentTaskId,
    pub agent_name: String,
    pub tool_name: String,
    pub tool_call_id: String,
    pub path: Option<PathBuf>,
    pub command: Option<String>,
    pub mcp_server: Option<String>,
    pub risk: RiskLevel,
}
```

2. 实现 rule engine。

规则维度：

- agent
- tool
- path
- command
- network
- MCP server
- git operation
- worktree operation
- secret file

3. 审批队列：
   - pending list
   - respond
   - batch respond
   - timeout
   - audit

4. 修改 `ToolPipeline`：
   - 每个需要权限的 tool call 先进入 permission engine。
   - `Ask` 时 tool execution 暂停。
   - `Deny` 时返回真实拒绝结果。

5. 修改 Tool trait 使用：
   - `needs_permissions` 继续保留。
   - 增加 richer permission context。

6. 策略版本和导入导出：
   - 可借鉴 OpenHarness `approval_policy_store.rs`。
   - 签名校验作为 P1/P2，根据产品需要决定是否首版进入。

### 12.2 测试

1. allow 工具真实执行。
2. ask 工具进入 pending，不执行。
3. approve 后继续执行。
4. reject 后不执行。
5. deny 直接阻断。
6. audit 记录真实决策。

### 12.3 完成标准

- 权限系统真实阻断执行。
- 审批中不会偷偷继续跑工具。
- 审计能追溯到具体 task/tool call。

## 13. 阶段 8：Shell 安全重写

### 13.1 要做什么

1. 新增 `security/shell`。

2. 实现 shell dialect：
   - PowerShell
   - cmd
   - bash/sh
   - zsh

3. 实现风险识别：
   - recursive delete
   - root/system drive delete
   - git reset/clean/checkout destructive
   - encoded command
   - command substitution
   - heredoc
   - curl/wget pipe shell
   - credential/env leak
   - cross workspace path
   - privilege escalation
   - process kill

4. 和 permission engine 对接：
   - low -> allow 或策略决定。
   - medium/high -> ask。
   - blocked -> deny。

5. BashTool 执行前必须通过 ShellRiskAnalyzer。

### 13.2 测试

必须覆盖：

- `rm -rf /`
- `Remove-Item -Recurse -Force C:\`
- `powershell -EncodedCommand`
- `curl ... | sh`
- `wget ... | bash`
- `git reset --hard`
- `git clean -fd`
- quoted newline 绕过
- PowerShell alias 绕过
- cmd `/c` 嵌套

### 13.3 完成标准

- Shell 安全不是字符串黑名单。
- 高危命令不能绕过审批或阻断。

## 14. 阶段 9：MCP / Skills / Hooks 隔离

### 14.1 要做什么

1. 每个 Agent task 创建 `ToolVisibilityContext`。

2. MCP：
   - 根据 AgentDefinition 的 `mcp_servers` 决定可见 server。
   - 只注入可见 MCP tool schema。
   - MCP tool call 绑定 task id。
   - MCP tool call 走 permission engine。

3. Skills：
   - 根据 AgentDefinition 的 `skills` 加载。
   - skills 内容注入 prompt/context。
   - transcript 记录加载了哪些 skills。

4. Hooks：
   - `before_agent_start`
   - `before_model_request`
   - `before_tool_call`
   - `after_tool_result`
   - `before_agent_finish`

5. Hooks 受权限控制。

### 14.2 测试

1. Agent A 看不到 Agent B 的 MCP tool。
2. 不允许 MCP server 被调用时真实阻断。
3. Skill 真实改变 system/context。
4. Hook 真实触发生命周期事件。
5. Hook 不能绕过权限。

### 14.3 完成标准

- 隔离不是 UI 过滤，而是 runtime 和 tool schema 层真实隔离。

## 15. 阶段 10：Streaming Tool Execution

### 15.1 要做什么

1. 扩展 `ToolPipeline` event 输出：
   - queued
   - running
   - progress
   - stdout
   - stderr
   - waiting_approval
   - completed
   - failed
   - cancelled

2. 工具执行事件写入 AgentTaskEvent。

3. 后台 task 支持事件订阅。

4. cancel task 时：
   - 取消 model request。
   - 取消 running tools。
   - 更新 transcript。

5. 并发策略：
   - read/search/MCP readonly 可并发。
   - write/edit/shell destructive 串行或受规则约束。

### 15.2 测试

1. 两个 read 并行。
2. 一个 write 和一个 shell 串行。
3. 审批中取消。
4. 长命令取消。
5. stdout/stderr 真实进入 event。

### 15.3 完成标准

- 后台 Agent 过程可观察。
- 工具不是黑盒。

## 16. 阶段 11：Patch Store 和 Diff Review

### 16.1 要做什么

1. 新增 `patches/patch_store.rs`。

核心类型：

```rust
pub enum PatchStatus {
    Pending,
    Accepted,
    Rejected,
    Applied,
    Conflicted,
}

pub struct AgentPatchRecord {
    pub patch_id: String,
    pub task_id: AgentTaskId,
    pub tool_call_id: String,
    pub relative_path: PathBuf,
    pub diff_preview: String,
    pub full_diff_ref: Option<String>,
    pub status: PatchStatus,
}
```

2. 文件写入类工具产生 patch record：
   - write
   - edit
   - search_replace
   - apply_patch

3. worktree task 完成后生成 patch package。

4. 支持：
   - list patches by task
   - accept patch
   - reject patch
   - mark conflicted
   - summary

5. 父 Agent 可读取 patch summary。

### 16.2 测试

1. 文件写入生成 patch。
2. patch 绑定 task/tool call。
3. accept/reject 状态真实持久化。
4. worktree diff 可汇总。

### 16.3 完成标准

- Agent 修改可审查、可追踪。
- 多 Agent 并发修改不再只有最终文件状态。

## 17. 阶段 12：Team / Swarm

### 17.1 要做什么

1. 新增 `team.rs`。

```rust
pub struct AgentTeam {
    pub team_id: String,
    pub name: String,
    pub objective: String,
    pub members: Vec<AgentTaskId>,
    pub mailbox_id: String,
}
```

2. `AgentTool` 支持 `team_name`。

3. 实现 mailbox：
   - send to agent
   - broadcast to team
   - wait for messages
   - summarize team status

4. Supervisor 控制 team 并发。

5. Team member 可使用独立 worktree。

6. Team result synthesis：
   - 成功成员结果。
   - 失败成员原因。
   - patch summary。
   - recommended next step。

### 17.2 测试

1. 三个 Agent 并发执行真实任务。
2. 一个失败，两个成功。
3. team summary 真实包含结果和失败。
4. mailbox 消息可追踪。

### 17.3 完成标准

- Team 不是批量启动命令。
- Team 是 native runtime 内的 Agent task group。

## 18. 阶段 13：桌面 API 和前端接入

### 18.1 后端 API

新增或扩展 Tauri commands：

- `agent_task_start`
- `agent_task_status`
- `agent_task_events`
- `agent_task_cancel`
- `agent_task_resume`
- `agent_task_list`
- `agent_task_transcript`
- `agent_task_patches`
- `agent_approval_list_pending`
- `agent_approval_respond`
- `agent_approval_respond_batch`
- `agent_team_status`

### 18.2 前端能力

1. Background Agent 面板：
   - running
   - waiting approval
   - succeeded
   - failed
   - cancelled
   - interrupted

2. Agent event timeline。

3. Approval center：
   - task
   - agent
   - tool
   - risk
   - reason
   - approve/reject

4. Patch review：
   - by task
   - by team
   - by worktree

5. Transcript viewer。

### 18.3 完成标准

- UI 展示的数据都来自真实 runtime。
- 没有 mock backend fallback 宣称能力可用。

## 19. 阶段 14：测试体系

### 19.1 单元测试

覆盖：

- AgentDefinition parser。
- AgentTaskRegistry。
- AgentSupervisor。
- TranscriptStore。
- PermissionEngine。
- ShellRiskAnalyzer。
- WorkspaceBinding。
- PatchStore。
- MCP tool visibility。

### 19.2 集成测试

覆盖：

1. foreground Agent 完成一次真实工具调用。
2. child Agent 完成一次真实读取。
3. background Agent 完成一次真实任务。
4. background Agent 可取消。
5. permission ask 后 approve 继续。
6. permission ask 后 reject 阻断。
7. worktree Agent 修改文件不影响主 workspace。
8. MCP tool schema 只注入允许的 server。
9. patch record 从真实写入产生。
10. recovery 能处理 interrupted task。

### 19.3 回归样本来源

从 claude-code-new 借鉴：

- AgentTool input schema case。
- background semantics case。
- worktree semantics case。
- permission rule case。

从 OpenHarness 借鉴：

- provider tool schema case。
- OpenAI tool call parse case。
- Anthropic tool call parse case。
- Gemini tool call parse case。
- approval policy import/export case。
- diff accept/reject case。

### 19.4 禁止测试

- 禁止只断言结构体存在。
- 禁止假 model response 绕开 execution pipeline。
- 禁止 fake tool result。
- 禁止把 `not implemented` 当成功能力。

## 20. 阶段 15：切换策略

### 20.1 灰度顺序

1. AgentDefinition parser 上线，不改变运行行为。
2. AgentTask runtime 内部上线，仅测试入口使用。
3. TaskTool 切到 AgentTaskSupervisor。
4. background Agent 开启。
5. transcript 和 events 开启。
6. permission engine dry-run。
7. permission engine enforce。
8. worktree isolation 开启。
9. patch review 开启。
10. per-agent MCP/Skills/Hooks 开启。
11. team/swarm 开启。

### 20.2 回滚策略

- 每个阶段必须 behind feature flag 或内部配置。
- 如果新 runtime 失败，旧普通对话不能受影响。
- 但不能把失败包装成成功。

### 20.3 删除旧逻辑

最后删除或降级：

- 临时 subagent session cleanup。
- 伪兼容字段。
- 未接入 permission engine 的 tool bypass。
- 未结构化的 task event。

## 21. 阶段 16：全项目 OpenHarness 命名收敛

### 21.1 要做什么

1. 扫描整个目标项目，找出所有旧项目名残留：
   - 文件名。
   - 目录名。
   - Rust crate name。
   - package name。
   - Tauri app identifier。
   - window title。
   - UI 文案。
   - README 和 docs。
   - 配置文件。
   - 数据库表名。
   - 日志 target。
   - telemetry/event name。
   - 环境变量。
   - 默认路径。
   - agent prompt。
   - test fixture。

2. 建立重命名映射表：
   - 旧品牌名统一改为 `OpenHarness`。
   - 旧小写标识统一改为 `openharness`。
   - 旧 snake_case 标识统一改为 `openharness` 或 `open_harness`，按所在语言和现有约定决定。
   - 旧 kebab-case 标识统一改为 `openharness` 或 `open-harness`，按包管理器和文件命名约定决定。

3. 先改非运行时文案：
   - docs。
   - README。
   - UI copy。
   - app title。
   - about 信息。

4. 再改代码级标识：
   - crate/package/app name。
   - module constant。
   - config key。
   - event name。
   - database filename。
   - storage namespace。

5. 最后改兼容性和迁移层：
   - 如果已有用户数据里存在旧 key，必须提供一次性迁移。
   - 迁移完成后，新写入数据不得继续使用旧 key。
   - 如果必须临时读取旧 key，只能作为 migration fallback，不能作为新能力路径。

6. 增加 CI/测试检查：
   - 搜索旧品牌名大小写变体。
   - 如果目标项目内仍存在旧品牌名，测试失败。
   - 允许列表只能包含迁移测试中的旧输入样本，且必须注明原因。

### 21.2 测试

1. 全仓搜索旧品牌名，普通源码和文档中结果为 0。
2. UI 构建产物中旧品牌名结果为 0。
3. Rust crate/package metadata 中旧品牌名结果为 0。
4. Tauri 配置和应用窗口标题中旧品牌名结果为 0。
5. 新建配置、新建数据库、新建日志事件不再出现旧品牌名。
6. 旧数据迁移测试通过。
7. allowlist 只允许迁移 fixture，不能允许生产代码残留。

### 21.3 完成标准

- 目标项目最终对外、对内、运行时、配置、文档、UI、测试产物全部统一为 OpenHarness。
- 不再留下旧品牌名。
- 旧品牌名只允许出现在迁移测试输入样本中，且不能进入发布产物。
- 不能只改 UI 文案，代码 namespace、配置 key、事件名、存储路径也必须收敛。

### 21.4 禁止事项

- 禁止保留旧品牌名作为“兼容展示”。
- 禁止新增旧品牌名 alias。
- 禁止只在 README 里说明“未来会改名”。
- 禁止让新功能继续写入旧命名空间。
- 禁止发布产物中出现旧品牌名。

## 22. 优先级

### P0：必须先做

1. AgentDefinition 扩展。
2. AgentTaskRegistry。
3. AgentTaskSupervisor。
4. TranscriptStore。
5. TaskTool 升级 AgentTool。
6. background task 真实执行。
7. cancel/status/events。

P0 完成后，最小真实能力成立：

- 可以创建真实子 Agent。
- 可以后台运行真实 Agent。
- 可以查询状态。
- 可以取消。
- 可以看 transcript。

### P1：让能力可安全使用

1. PermissionEngine。
2. ApprovalQueue。
3. AuditStore。
4. WorktreeIsolation。
5. PatchStore。
6. Diff review。

P1 完成后，能力进入可用于真实项目的水平。

### P2：补齐 Claude Code 级工作流

1. Per-agent MCP。
2. Per-agent Skills。
3. Hooks。
4. Streaming tool events。
5. ShellRiskAnalyzer 完整版。

### P3：高级协作

1. Team。
2. Swarm。
3. Mailbox。
4. Team summary。
5. 多 worktree merge orchestration。

## 23. 最终验收清单

最终版本必须满足：

- Agent runtime 完全原生 Rust 实现。
- 没有 sidecar Agent runtime。
- 没有 fake background。
- 没有 fake subagent。
- 没有 fake tool result。
- 没有 fake permission。
- 后台 Agent 可真实执行、查询、取消、恢复。
- 子 Agent 有独立 transcript。
- 父子 Agent 关系可追踪。
- 工具调用走真实 ToolPipeline。
- 权限审批能真实暂停和阻断。
- Shell 风险分析可测试。
- worktree isolation 真实创建工作区。
- MCP tool 按 Agent 隔离。
- Skills 按 Agent 注入。
- Hooks 真实执行且受权限控制。
- patch/diff 可审查。
- 多 Agent 协作不依赖外部终端或 sidecar。

## 24. 实施原则

1. 宁可少做，也不做假。
2. 每个 API 如果没有真实实现，必须返回 `not implemented`。
3. 每个 UI 能力必须有真实后端链路。
4. 每个 Agent 状态必须来自真实 runtime。
5. 每个工具结果必须来自真实工具。
6. 每个权限记录必须来自真实决策。
7. 每个阶段必须有测试固定行为。
8. OpenHarness 和 claude-code-new 只作为参考，不作为 runtime 依赖。


