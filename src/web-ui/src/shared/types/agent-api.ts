/**
 * Agent/tool API DTOs (frontend).
 *
 * These types mirror backend request/response payloads and intentionally use
 * snake_case fields to match the wire format.
 */
export type WirePayload = any;
export type WireObject = Record<string, WirePayload>;
export type AgentTaskUpdateType = 'task_started' | 'task_progress' | 'task_completed' | 'task_error';
export type AgentTaskStatus = 'completed' | 'error';
export type StreamContentType = 'text' | 'tool_result' | 'thinking';
export type ModelContentType = StreamContentType | 'tool_call';
export type ModelRoundStatus = 'completed' | 'pending_confirmation' | 'error';

export interface TaskScopedEvent {
  task_id: string;
  timestamp?: number;
}

export interface DialogScopedEvent extends TaskScopedEvent {
  dialog_turn_id: string;
}

export interface ModelRoundScopedEvent extends DialogScopedEvent {
  model_round_id: string;
}

export interface AgentExecutionRequest {
  agent_type: string;
  prompt: string;
  description?: string;
  model_name?: string;
  workspace_path?: string;
  context?: Record<string, string>;
  safe_mode?: boolean;
  verbose?: boolean;
}

export interface AgentExecutionResponse {
  id: string;
  status: string;
  result?: WirePayload;
  error?: string;
  progress?: string;
  agent_type: string;
  duration_ms?: number;
  tool_uses?: number;
}

export interface AgentInfo {
  agent_type: string;
  when_to_use: string;
  tools: string;
  system_prompt?: string;
  location: string;
  color?: string;
  model_name?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  input_schema: WirePayload;
  is_readonly: boolean;
  is_concurrency_safe: boolean;
  needs_permissions: boolean;
}

export interface ToolExecutionRequest {
  tool_name: string;
  input: WirePayload;
  context?: Record<string, string>;
  safe_mode?: boolean;
}

export interface ToolExecutionResponse {
  tool_name: string;
  success: boolean;
  result?: WirePayload;
  error?: string;
  validation_error?: string;
  duration_ms: number;
}

export interface ToolValidationRequest {
  tool_name: string;
  input: WirePayload;
}

export interface ToolValidationResponse {
  tool_name: string;
  valid: boolean;
  message?: string;
  error_code?: number;
  meta?: WirePayload;
}


export interface AgentTaskUpdateEvent extends TaskScopedEvent {
  type: AgentTaskUpdateType;
  data?: WirePayload;
  error?: string;
  progress?: string;
  agent_type?: string;
  description?: string;
}





export interface DialogTurnStartEvent extends DialogScopedEvent {
  dialog_turn_id: string;
  user_message: string;
  timestamp: number;
}

export interface DialogTurnCompleteEvent extends DialogScopedEvent {
  status: AgentTaskStatus;
  total_model_rounds: number;
  timestamp: number;
}


export interface ModelRoundStartEvent extends ModelRoundScopedEvent {
  model_round_index: number;
  timestamp: number;
}

export interface ModelRoundContentEvent extends ModelRoundScopedEvent {
  content_id: string;
  content_type: ModelContentType;
  content: string;
  metadata?: {
    tool_name?: string;
    tool_use_id?: string;
    tool_input?: WirePayload;
    is_streaming?: boolean;
    chunk_index?: number;
    total_chunks?: number;
  };
  timestamp: number;
}

export interface ModelRoundEndEvent extends ModelRoundScopedEvent {
  round_status: ModelRoundStatus;
  timestamp: number;
}


export interface TaskCompleteEvent extends TaskScopedEvent {
  status: AgentTaskStatus;
  total_dialog_turns: number;
  result?: WirePayload;
  timestamp: number;
}

export interface TaskErrorEvent extends TaskScopedEvent {
  dialog_turn_id?: string;
  model_round_id?: string;
  error: string;
  timestamp: number;
}


 
export interface StreamChunkEvent extends TaskScopedEvent {
  type: StreamContentType;
  content: string;
  model_round_id?: string;    
  dialog_turn_id?: string;    
  chunk_index?: number;
  total_chunks?: number;
  timestamp: number;
}

 
export interface StreamToolUseEvent extends TaskScopedEvent {
  tool_use_id: string;
  tool_name: string;
  input: WirePayload;
  model_round_id?: string;    
  dialog_turn_id?: string;    
  timestamp: number;
}

 
export interface StreamToolResultEvent extends TaskScopedEvent {
  type: 'tool_result';
  content: string;
  timestamp: number;
}

 
export interface StreamStartEvent {
  task_id: string;
  agent_type: string;
  prompt: string;
}

 
export interface StreamCompleteEvent {
  task_id: string;
  status: 'completed';
  result?: WirePayload;
}

 
export interface StreamErrorEvent {
  task_id: string;
  error: string;
  timestamp?: number;
}

export interface StreamProgressEvent {
  task_id: string;
  type: 'progress';
  timestamp: number;
}


export interface ToolCallConfirmationEvent {
  request: {
    call_id: string;
    name: string;
    args: WireObject;
    is_client_initiated: boolean;
    prompt_id: string;
  };
  confirmation_type: string; // 'edit' | 'execute' | 'confirm'
  message?: string;
  file_diff?: string;
  file_name?: string;
  original_content?: string;
  new_content?: string;
}
