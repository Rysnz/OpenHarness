export type SessionStatus = 'Running' | 'Stopped' | 'Exited' | 'Error';
export type TerminalSessionSource = 'manual' | 'agent';
export type ShellType = 'PowerShell' | 'Cmd' | 'Bash' | 'Zsh' | 'Fish' | 'Sh';
export type CommandCompletionReason = 'completed' | 'timedOut';
export type TerminalEventType = 'ready' | 'output' | 'exit' | 'error' | 'resize' | 'title' | 'cwd';

export interface CreateSessionRequest {
  sessionId?: string;
  name?: string;
  shellType?: ShellType | string;
  workingDirectory?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  source?: TerminalSessionSource;
}

export interface SessionResponse {
  id: string;
  name: string;
  shellType: string;
  cwd: string;
  pid?: number;
  status: SessionStatus | string;
  cols: number;
  rows: number;
  connectionId?: string;
  source: TerminalSessionSource;
}

export interface ShellInfo {
  shellType: string;
  name: string;
  path: string;
  version?: string;
  available: boolean;
}

export interface SessionIdRequest {
  sessionId: string;
}

export interface WriteRequest extends SessionIdRequest {
  data: string;
}

export interface ResizeRequest extends SessionIdRequest {
  cols: number;
  rows: number;
}

export interface CloseSessionRequest extends SessionIdRequest {
  immediate?: boolean;
}

export interface SignalRequest extends SessionIdRequest {
  signal: string;
}

export interface AcknowledgeRequest extends SessionIdRequest {
  charCount: number;
}

export interface ExecuteCommandRequest extends SessionIdRequest {
  command: string;
  timeoutMs?: number;
  preventHistory?: boolean;
}

export interface ExecuteCommandResponse {
  command: string;
  commandId: string;
  output: string;
  exitCode?: number;
  completionReason: CommandCompletionReason;
}

export interface SendCommandRequest extends SessionIdRequest {
  command: string;
}

export interface GetHistoryResponse extends SessionIdRequest {
  data: string;
  historySize: number;
  cols: number;
  rows: number;
}

export interface TerminalEventBase extends SessionIdRequest {
  type: TerminalEventType;
  timestamp?: number;
}

export interface TerminalReadyEvent extends TerminalEventBase {
  type: 'ready';
}

export interface TerminalOutputEvent extends TerminalEventBase {
  type: 'output';
  data: string;
}

export interface TerminalExitEvent extends TerminalEventBase {
  type: 'exit';
  exitCode?: number;
}

export interface TerminalErrorEvent extends TerminalEventBase {
  type: 'error';
  message: string;
}

export interface TerminalResizeEvent extends TerminalEventBase {
  type: 'resize';
  cols: number;
  rows: number;
}

export interface TerminalTitleEvent extends TerminalEventBase {
  type: 'title';
  title: string;
}

export interface TerminalCwdEvent extends TerminalEventBase {
  type: 'cwd';
  cwd: string;
}

export type TerminalEvent =
  | TerminalReadyEvent
  | TerminalOutputEvent
  | TerminalExitEvent
  | TerminalErrorEvent
  | TerminalResizeEvent
  | TerminalTitleEvent
  | TerminalCwdEvent;

export type TerminalEventCallback = (event: TerminalEvent) => void;
export type UnsubscribeFunction = () => void;
