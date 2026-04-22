 

import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';
import type { ImageContextData as ImageInputContextData } from './ImageContextTypes';



export interface SessionTitleGeneratedEvent {
  sessionId: string;
  title: string;
  method: 'ai' | 'fallback';
  timestamp: number;
}

 
export interface SessionConfig {
  modelName?: string;
  maxContextTokens?: number;
  autoCompact?: boolean;
  enableTools?: boolean;
  safeMode?: boolean;
  maxTurns?: number;
  enableContextCompression?: boolean;
  compressionThreshold?: number;
  remoteConnectionId?: string;
  remoteSshHost?: string;
}

 
export interface CreateSessionRequest {
  sessionId?: string; 
  sessionName: string;
  agentType: string;
  workspacePath: string;
  remoteConnectionId?: string;
  remoteSshHost?: string;
  config?: SessionConfig;
}

 
export interface CreateSessionResponse {
  sessionId: string;
  sessionName: string;
  agentType: string;
}

 
export interface StartDialogTurnRequest {
  sessionId: string;
  userInput: string;
  originalUserInput?: string;
  turnId?: string; 
  agentType: string; 
  workspacePath?: string;
  /** Optional multimodal image contexts (snake_case fields, aligned with backend ImageContextData). */
  imageContexts?: ImageInputContextData[];
}

export interface CompactSessionRequest {
  sessionId: string;
  workspacePath?: string;
  remoteConnectionId?: string;
  remoteSshHost?: string;
}

 
export interface SessionInfo {
  sessionId: string;
  sessionName: string;
  agentType: string;
  state: string;
  turnCount: number;
  createdAt: number;
}

export interface EnsurePartnerBootstrapRequest {
  sessionId: string;
  workspacePath: string;
}

export type EnsurePartnerBootstrapStatus = 'started' | 'skipped' | 'blocked';

export type EnsurePartnerBootstrapReason =
  | 'bootstrap_started'
  | 'bootstrap_not_required'
  | 'session_has_existing_turns'
  | 'session_not_idle'
  | 'model_unavailable';

export interface EnsurePartnerBootstrapResponse {
  status: EnsurePartnerBootstrapStatus;
  reason: EnsurePartnerBootstrapReason;
  sessionId: string;
  turnId?: string;
  detail?: string;
}

export interface UpdateSessionModelRequest {
  sessionId: string;
  modelName: string;
}

export interface UpdateSessionTitleRequest {
  sessionId: string;
  title: string;
  workspacePath?: string;
  remoteConnectionId?: string;
  remoteSshHost?: string;
}

 
export interface ModeInfo {
  id: string;
  name: string;
  description: string;
  isReadonly: boolean;
  toolCount: number;
  defaultTools?: string[];
  enabled: boolean;
}

export type PermissionAction = 'read' | 'write' | 'shell' | 'mcp' | 'worktree' | 'other';
export type PermissionRiskLevel = 'low' | 'medium' | 'high';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface PermissionRule {
  ruleId: string;
  agentName?: string | null;
  toolName?: string | null;
  pathPrefix?: string | null;
  commandContains?: string | null;
  mcpServer?: string | null;
  decision: PermissionDecision;
  riskLevel: PermissionRiskLevel;
  reason: string;
}

export interface PermissionApprovalRequest {
  requestId: string;
  toolCallId: string;
  toolName: string;
  action: PermissionAction;
  riskLevel: PermissionRiskLevel;
  reason: string;
  sessionId: string;
  dialogTurnId: string;
  params: unknown;
  createdAtMs: number;
}

export interface PermissionAuditRecord {
  auditId: string;
  toolCallId: string;
  toolName: string;
  action: PermissionAction;
  riskLevel: PermissionRiskLevel;
  decision: PermissionDecision;
  effectiveDecision: PermissionDecision;
  reason: string;
  sessionId: string;
  dialogTurnId: string;
  approved?: boolean | null;
  timestampMs: number;
}

export interface AgentApprovalRespondRequest {
  toolId: string;
  approved: boolean;
  reason?: string | null;
  updatedInput?: unknown;
}

export interface AgentApprovalRespondBatchResult {
  toolId: string;
  success: boolean;
  error?: string | null;
}

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type AgentTaskKind = 'foreground' | 'child' | 'background' | 'team_member';

export interface AgentTaskConfig {
  agent_name: string;
  prompt: string;
  parent_task_id?: string | null;
  session_id?: string | null;
  workspace_binding: any;
  fork_context: 'fresh' | 'inherit_parent';
  max_turns?: number | null;
  allowed_tools: string[];
  model?: string | null;
}

export interface AgentTaskSnapshot {
  task_id: string;
  status: AgentTaskStatus;
  kind: AgentTaskKind;
  config: AgentTaskConfig;
  created_at_ms: number;
  started_at_ms?: number | null;
  completed_at_ms?: number | null;
  last_error?: string | null;
  result_summary?: string | null;
  transcript_ref?: string | null;
}

export interface AgentTaskEvent {
  event_id: string;
  task_id: string;
  kind: string;
  timestamp_ms: number;
  message?: string | null;
  data?: any;
}

export interface AgentTranscript {
  task_id: string;
  initial_prompt: string;
  entries: any[];
}

export type AgentPatchStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'applied'
  | 'conflicted';

export interface AgentPatchRecord {
  patch_id: string;
  task_id: string;
  tool_call_id: string;
  relative_path: string;
  diff_preview: string;
  full_diff_ref?: string | null;
  status: AgentPatchStatus;
}

export interface AgentPatchSummary {
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  applied: number;
  conflicted: number;
}

export interface ListAgentTasksRequest {
  statuses?: AgentTaskStatus[];
  kinds?: AgentTaskKind[];
  parentTaskId?: string;
  sessionId?: string;
}



export interface SubagentParentInfo {
  toolCallId: string;
  sessionId: string;
  dialogTurnId: string;
}

export interface AgenticEvent {
  sessionId: string;
  turnId?: string;
  subagentParentInfo?: SubagentParentInfo;
  [key: string]: any;
}

export interface TextChunkEvent extends AgenticEvent {
  roundId: string;
  text: string;
  contentType?: 'text' | 'thinking';
  isThinkingEnd?: boolean;
  subagentParentInfo?: SubagentParentInfo;
}

export interface ToolEvent extends AgenticEvent {
  toolEvent: any;
  subagentParentInfo?: SubagentParentInfo;
}

 
export interface ImageAnalysisEvent extends AgenticEvent {
  imageCount?: number;
  userInput?: string;
  success?: boolean;
  durationMs?: number;
}

export interface CompressionEvent extends AgenticEvent {
  compressionId: string;          
  
  trigger?: string;                // "auto" | "manual" | "user_message"
  tokensBefore?: number;           
  contextWindow?: number;          
  threshold?: number;              
  
  compressionCount?: number;       
  tokensAfter?: number;            
  compressionRatio?: number;       
  durationMs?: number;             
  hasSummary?: boolean;            
  summarySource?: 'model' | 'local_fallback' | 'none';
  
  error?: string;                  
  subagentParentInfo?: SubagentParentInfo;
}



export class AgentAPI {
  
  

  

   
  async createSession(request: CreateSessionRequest): Promise<CreateSessionResponse> {
    try {
      return await api.invoke<CreateSessionResponse>('create_session', { request });
    } catch (error) {
      throw createTauriCommandError('create_session', error, request);
    }
  }

   
  async startDialogTurn(request: StartDialogTurnRequest): Promise<{ success: boolean; message: string }> {
    try {
      return await api.invoke<{ success: boolean; message: string }>('start_dialog_turn', { request });
    } catch (error) {
      throw createTauriCommandError('start_dialog_turn', error, request);
    }
  }

  async compactSession(request: CompactSessionRequest): Promise<{ success: boolean; message: string }> {
    try {
      return await api.invoke<{ success: boolean; message: string }>('compact_session', { request });
    } catch (error) {
      throw createTauriCommandError('compact_session', error, request);
    }
  }

  async ensurePartnerBootstrap(
    request: EnsurePartnerBootstrapRequest
  ): Promise<EnsurePartnerBootstrapResponse> {
    try {
      return await api.invoke<EnsurePartnerBootstrapResponse>('ensure_partner_bootstrap', {
        request
      });
    } catch (error) {
      throw createTauriCommandError('ensure_partner_bootstrap', error, request);
    }
  }

   
  async cancelDialogTurn(sessionId: string, dialogTurnId: string): Promise<void> {
    try {
      await api.invoke<void>('cancel_dialog_turn', { request: { sessionId, dialogTurnId } });
    } catch (error) {
      throw createTauriCommandError('cancel_dialog_turn', error, { sessionId, dialogTurnId });
    }
  }

   
  async deleteSession(
    sessionId: string,
    workspacePath: string,
    remoteConnectionId?: string,
    remoteSshHost?: string
  ): Promise<void> {
    try {
      await api.invoke<void>('delete_session', { 
        request: { sessionId, workspacePath, remoteConnectionId, remoteSshHost } 
      });
    } catch (error) {
      throw createTauriCommandError('delete_session', error, { sessionId, workspacePath });
    }
  }

   
  async restoreSession(
    sessionId: string,
    workspacePath: string,
    remoteConnectionId?: string,
    remoteSshHost?: string
  ): Promise<SessionInfo> {
    try {
      return await api.invoke<SessionInfo>('restore_session', {
        request: { sessionId, workspacePath, remoteConnectionId, remoteSshHost },
      });
    } catch (error) {
      throw createTauriCommandError('restore_session', error, { sessionId, workspacePath });
    }
  }

  /**
   * No-op if the session is already in the coordinator; otherwise loads it from disk
   * using the same workspace path resolution as restore_session (required for SSH remote workspaces).
   */
  async ensureCoordinatorSession(request: {
    sessionId: string;
    workspacePath: string;
    remoteConnectionId?: string;
    remoteSshHost?: string;
  }): Promise<void> {
    try {
      await api.invoke<void>('ensure_coordinator_session', { request });
    } catch (error) {
      throw createTauriCommandError('ensure_coordinator_session', error, request);
    }
  }

  async updateSessionModel(request: UpdateSessionModelRequest): Promise<void> {
    try {
      await api.invoke<void>('update_session_model', { request });
    } catch (error) {
      throw createTauriCommandError('update_session_model', error, request);
    }
  }

  async updateSessionTitle(request: UpdateSessionTitleRequest): Promise<string> {
    try {
      return await api.invoke<string>('update_session_title', { request });
    } catch (error) {
      throw createTauriCommandError('update_session_title', error, request);
    }
  }


   
  async listSessions(
    workspacePath: string,
    remoteConnectionId?: string,
    remoteSshHost?: string
  ): Promise<SessionInfo[]> {
    try {
      return await api.invoke<SessionInfo[]>('list_sessions', {
        request: { workspacePath, remoteConnectionId, remoteSshHost },
      });
    } catch (error) {
      throw createTauriCommandError('list_sessions', error, { workspacePath });
    }
  }

  async confirmToolExecution(sessionId: string, toolId: string): Promise<void> {
    try {
      await api.invoke<void>('confirm_tool_execution', {
        request: {
          sessionId,
          toolId
        }
      });
    } catch (error) {
      throw createTauriCommandError('confirm_tool_execution', error, { sessionId, toolId });
    }
  }

   
  async rejectToolExecution(sessionId: string, toolId: string, reason?: string): Promise<void> {
    try {
      await api.invoke<void>('reject_tool_execution', {
        request: {
          sessionId,
          toolId,
          reason
        }
      });
    } catch (error) {
      throw createTauriCommandError('reject_tool_execution', error, { sessionId, toolId, reason });
    }
  }

  async listPendingApprovals(): Promise<PermissionApprovalRequest[]> {
    try {
      return await api.invoke<PermissionApprovalRequest[]>('agent_approval_list_pending');
    } catch (error) {
      throw createTauriCommandError('agent_approval_list_pending', error);
    }
  }

  async respondApproval(request: AgentApprovalRespondRequest): Promise<void> {
    try {
      await api.invoke<void>('agent_approval_respond', { request });
    } catch (error) {
      throw createTauriCommandError('agent_approval_respond', error, request);
    }
  }

  async respondApprovalsBatch(
    items: AgentApprovalRespondRequest[]
  ): Promise<AgentApprovalRespondBatchResult[]> {
    try {
      return await api.invoke<AgentApprovalRespondBatchResult[]>(
        'agent_approval_respond_batch',
        { request: { items } }
      );
    } catch (error) {
      throw createTauriCommandError('agent_approval_respond_batch', error, { items });
    }
  }

  async listPermissionAudits(limit = 200): Promise<PermissionAuditRecord[]> {
    try {
      return await api.invoke<PermissionAuditRecord[]>('agent_approval_audit_recent', {
        request: { limit }
      });
    } catch (error) {
      throw createTauriCommandError('agent_approval_audit_recent', error, { limit });
    }
  }

  async listPermissionRules(): Promise<PermissionRule[]> {
    try {
      return await api.invoke<PermissionRule[]>('agent_permission_rule_list');
    } catch (error) {
      throw createTauriCommandError('agent_permission_rule_list', error);
    }
  }

  async upsertPermissionRule(rule: PermissionRule): Promise<PermissionRule[]> {
    try {
      return await api.invoke<PermissionRule[]>('agent_permission_rule_upsert', {
        request: { rule }
      });
    } catch (error) {
      throw createTauriCommandError('agent_permission_rule_upsert', error, { rule });
    }
  }

  async removePermissionRule(ruleId: string): Promise<PermissionRule[]> {
    try {
      return await api.invoke<PermissionRule[]>('agent_permission_rule_remove', {
        request: { ruleId }
      });
    } catch (error) {
      throw createTauriCommandError('agent_permission_rule_remove', error, { ruleId });
    }
  }

  async clearPermissionRules(): Promise<PermissionRule[]> {
    try {
      return await api.invoke<PermissionRule[]>('agent_permission_rule_clear');
    } catch (error) {
      throw createTauriCommandError('agent_permission_rule_clear', error);
    }
  }

  async replacePermissionRules(rules: PermissionRule[]): Promise<PermissionRule[]> {
    try {
      return await api.invoke<PermissionRule[]>('agent_permission_rule_replace_all', {
        request: { rules }
      });
    } catch (error) {
      throw createTauriCommandError('agent_permission_rule_replace_all', error, { rules });
    }
  }
  

   
  onSessionCreated(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://session-created', callback);
  }

  onSessionDeleted(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://session-deleted', callback);
  }

  onSessionStateChanged(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://session-state-changed', callback);
  }

   
  onDialogTurnStarted(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://dialog-turn-started', callback);
  }

   
  onModelRoundStarted(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://model-round-started', callback);
  }

   
  onTextChunk(callback: (event: TextChunkEvent) => void): () => void {
    return api.listen<TextChunkEvent>('agentic://text-chunk', callback);
  }

   
  onToolEvent(callback: (event: ToolEvent) => void): () => void {
    return api.listen<ToolEvent>('agentic://tool-event', callback);
  }

   
  onDialogTurnCompleted(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://dialog-turn-completed', callback);
  }

   
  onDialogTurnFailed(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://dialog-turn-failed', callback);
  }

   
  onDialogTurnCancelled(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://dialog-turn-cancelled', callback);
  }

   
  onTokenUsageUpdated(callback: (event: AgenticEvent) => void): () => void {
    return api.listen<AgenticEvent>('agentic://token-usage-updated', callback);
  }

   
  onContextCompressionStarted(callback: (event: CompressionEvent) => void): () => void {
    return api.listen<CompressionEvent>('agentic://context-compression-started', callback);
  }

   
  onContextCompressionCompleted(callback: (event: CompressionEvent) => void): () => void {
    return api.listen<CompressionEvent>('agentic://context-compression-completed', callback);
  }

   
  onContextCompressionFailed(callback: (event: CompressionEvent) => void): () => void {
    return api.listen<CompressionEvent>('agentic://context-compression-failed', callback);
  }

  onImageAnalysisStarted(callback: (event: ImageAnalysisEvent) => void): () => void {
    return api.listen<ImageAnalysisEvent>('agentic://image-analysis-started', callback);
  }

  onImageAnalysisCompleted(callback: (event: ImageAnalysisEvent) => void): () => void {
    return api.listen<ImageAnalysisEvent>('agentic://image-analysis-completed', callback);
  }

   
  async getAvailableTools(): Promise<string[]> {
    try {
      return await api.invoke<string[]>('get_available_tools');
    } catch (error) {
      throw createTauriCommandError('get_available_tools', error);
    }
  }

   
  async generateSessionTitle(
    sessionId: string,
    userMessage: string,
    maxLength?: number
  ): Promise<string> {
    try {
      return await api.invoke<string>('generate_session_title', {
        request: {
          sessionId,
          userMessage,
          maxLength: maxLength || 20
        }
      });
    } catch (error) {
      throw createTauriCommandError('generate_session_title', error, {
        sessionId,
        userMessage,
        maxLength
      });
    }
  }

  async listAgentTasks(request: ListAgentTasksRequest = {}): Promise<AgentTaskSnapshot[]> {
    try {
      return await api.invoke<AgentTaskSnapshot[]>('list_agent_tasks', { request });
    } catch (error) {
      throw createTauriCommandError('list_agent_tasks', error, request);
    }
  }

  async getAgentTask(taskId: string): Promise<AgentTaskSnapshot | null> {
    try {
      return await api.invoke<AgentTaskSnapshot | null>('get_agent_task', {
        request: { taskId }
      });
    } catch (error) {
      throw createTauriCommandError('get_agent_task', error, { taskId });
    }
  }

  async cancelAgentTask(taskId: string, reason?: string): Promise<AgentTaskSnapshot> {
    try {
      return await api.invoke<AgentTaskSnapshot>('cancel_agent_task', {
        request: { taskId, reason }
      });
    } catch (error) {
      throw createTauriCommandError('cancel_agent_task', error, { taskId, reason });
    }
  }

  async getAgentTaskEvents(taskId: string): Promise<AgentTaskEvent[]> {
    try {
      return await api.invoke<AgentTaskEvent[]>('get_agent_task_events', {
        request: { taskId }
      });
    } catch (error) {
      throw createTauriCommandError('get_agent_task_events', error, { taskId });
    }
  }

  async getAgentTaskTranscript(taskId: string): Promise<AgentTranscript | null> {
    try {
      return await api.invoke<AgentTranscript | null>('get_agent_task_transcript', {
        request: { taskId }
      });
    } catch (error) {
      throw createTauriCommandError('get_agent_task_transcript', error, { taskId });
    }
  }

  async getAgentTaskPatches(taskId: string): Promise<AgentPatchRecord[]> {
    try {
      return await api.invoke<AgentPatchRecord[]>('get_agent_task_patches', {
        request: { taskId }
      });
    } catch (error) {
      throw createTauriCommandError('get_agent_task_patches', error, { taskId });
    }
  }

  async updateAgentTaskPatchStatus(
    taskId: string,
    patchId: string,
    status: AgentPatchStatus
  ): Promise<AgentPatchRecord> {
    try {
      return await api.invoke<AgentPatchRecord>('update_agent_task_patch_status', {
        request: { taskId, patchId, status }
      });
    } catch (error) {
      throw createTauriCommandError('update_agent_task_patch_status', error, {
        taskId,
        patchId,
        status
      });
    }
  }

  async applyAgentTaskPatch(taskId: string, patchId: string): Promise<AgentPatchRecord> {
    try {
      return await api.invoke<AgentPatchRecord>('apply_agent_task_patch', {
        request: { taskId, patchId }
      });
    } catch (error) {
      throw createTauriCommandError('apply_agent_task_patch', error, {
        taskId,
        patchId
      });
    }
  }

  async rejectAgentTaskPatchWithRollback(
    taskId: string,
    patchId: string
  ): Promise<AgentPatchRecord> {
    try {
      return await api.invoke<AgentPatchRecord>('reject_agent_task_patch', {
        request: { taskId, patchId }
      });
    } catch (error) {
      throw createTauriCommandError('reject_agent_task_patch', error, {
        taskId,
        patchId
      });
    }
  }

  async mergeAgentTaskPatches(taskId: string): Promise<AgentPatchRecord[]> {
    try {
      return await api.invoke<AgentPatchRecord[]>('merge_agent_task_patches', {
        request: { taskId }
      });
    } catch (error) {
      throw createTauriCommandError('merge_agent_task_patches', error, {
        taskId
      });
    }
  }

  async getAgentTaskPatchSummary(taskId: string): Promise<AgentPatchSummary> {
    try {
      return await api.invoke<AgentPatchSummary>('get_agent_task_patch_summary', {
        request: { taskId }
      });
    } catch (error) {
      throw createTauriCommandError('get_agent_task_patch_summary', error, { taskId });
    }
  }

  async acceptAgentTaskPatch(taskId: string, patchId: string): Promise<AgentPatchRecord> {
    return this.updateAgentTaskPatchStatus(taskId, patchId, 'accepted');
  }

  async rejectAgentTaskPatch(taskId: string, patchId: string): Promise<AgentPatchRecord> {
    return this.rejectAgentTaskPatchWithRollback(taskId, patchId);
  }

  async markAgentTaskPatchConflicted(taskId: string, patchId: string): Promise<AgentPatchRecord> {
    return this.updateAgentTaskPatchStatus(taskId, patchId, 'conflicted');
  }

   
  onSessionTitleGenerated(
    callback: (event: SessionTitleGeneratedEvent) => void
  ): () => void {
    return api.listen<SessionTitleGeneratedEvent>('session_title_generated', callback);
  }

  async cancelSession(sessionId: string): Promise<void> {
    try {
      await api.invoke<void>('cancel_session', {
        request: { sessionId }
      });
    } catch (error) {
      throw createTauriCommandError('cancel_session', error, { sessionId });
    }
  }

  async getAgentInfo(agentType: string): Promise<ModeInfo & { agent_type: string; when_to_use: string; tools: string; location: string }> {
    return {
      id: agentType,
      name: agentType,
      description: `${agentType} agent`,
      isReadonly: false,
      toolCount: 0,
      enabled: true,
      agent_type: agentType,
      when_to_use: `Use ${agentType} for related tasks`,
      tools: 'all',
      location: 'builtin',
    };
  }

  

   
  async getAvailableModes(): Promise<ModeInfo[]> {
    try {
      return await api.invoke<ModeInfo[]>('get_available_modes');
    } catch (error) {
      throw createTauriCommandError('get_available_modes', error);
    }
  }

}


export const agentAPI = new AgentAPI();
