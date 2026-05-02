import { createLogger } from '../../../shared/utils/logger';
import { agentAPI } from '../../api';
import { i18nService } from '@/infrastructure/i18n';

const logger = createLogger('AgentService');

type AgentType = 'project_qa' | 'requirement_clarification' | 'core';
type AgentEventCallbacks = {
  onModelRoundStart?: (event: any) => void;
  onTextChunk?: (event: any) => void;
  onToolCall?: (event: any) => void;
  onToolResult?: (event: any) => void;
  onToolConfirmation?: (event: any) => void;
  onProgress?: (event: any) => void;
  onComplete?: (event: any) => void;
  onError?: (error: any) => void;
};

type AgentHealth = {
  healthy: boolean;
  name: string;
  description: string;
};

export interface AgentResponse {
  content: string;
  metadata: Record<string, any>;
}

export interface AgentCallOptions {
  agentType: AgentType;
  message: string;
  workspacePath?: string;
}

export interface AgentExecutionRequest {
  agent_type: string;
  prompt: string;
  model_name?: string;
  workspace_path?: string;
  context?: Record<string, string>;
  verbose?: boolean;
}

class SessionRegistry {
  private readonly sessions = new Map<string, string>();

  get(agentType: string, workspacePath: string): string | undefined {
    return this.sessions.get(this.key(agentType, workspacePath));
  }

  set(agentType: string, workspacePath: string, sessionId: string): void {
    this.sessions.set(this.key(agentType, workspacePath), sessionId);
  }

  delete(agentType: string, workspacePath: string): void {
    this.sessions.delete(this.key(agentType, workspacePath));
  }

  clear(): void {
    this.sessions.clear();
  }

  private key(agentType: string, workspacePath: string): string {
    return `${workspacePath}::${agentType}`;
  }
}

class SubscriptionGroup {
  private readonly disposers: Array<() => void> = [];

  add(disposer: () => void): void {
    this.disposers.push(disposer);
  }

  dispose(): void {
    this.disposers.splice(0).forEach((dispose) => dispose());
  }
}

const AGENT_TEXT_KEYS: Record<AgentType, { name: string; description: string }> = {
  project_qa: {
    name: 'common:agents.projectQa.name',
    description: 'common:agents.projectQa.description'
  },
  requirement_clarification: {
    name: 'common:agents.requirementClarification.name',
    description: 'common:agents.requirementClarification.description'
  },
  core: {
    name: 'common:agents.core.name',
    description: 'common:agents.core.description'
  }
};

const requireWorkspacePath = (request: AgentExecutionRequest): string => {
  if (!request.workspace_path) {
    throw new Error('Workspace path is required to start an agent task');
  }

  return request.workspace_path;
};

const dispatchToolEvent = (toolEvent: any, callbacks: AgentEventCallbacks): void => {
  if (toolEvent.Started || toolEvent.EarlyDetected) {
    callbacks.onToolCall?.(toolEvent);
  } else if (toolEvent.Completed || toolEvent.Failed) {
    callbacks.onToolResult?.(toolEvent);
  } else if (toolEvent.ConfirmationNeeded) {
    callbacks.onToolConfirmation?.(toolEvent);
  } else if (toolEvent.Progress || toolEvent.StreamChunk) {
    callbacks.onProgress?.(toolEvent);
  }
};

const subscribeToSessionEvents = async (
  sessionId: string,
  callbacks: AgentEventCallbacks
): Promise<SubscriptionGroup> => {
  const subscriptions = new SubscriptionGroup();
  const belongsToSession = (event: any) => event.sessionId === sessionId;

  if (callbacks.onTextChunk) {
    subscriptions.add(await agentAPI.onTextChunk((event) => {
      if (belongsToSession(event)) {
        callbacks.onTextChunk?.(event);
      }
    }));
  }

  if (callbacks.onModelRoundStart) {
    subscriptions.add(await agentAPI.onModelRoundStarted((event) => {
      if (belongsToSession(event)) {
        callbacks.onModelRoundStart?.(event);
      }
    }));
  }

  if (callbacks.onToolCall || callbacks.onToolResult || callbacks.onToolConfirmation || callbacks.onProgress) {
    subscriptions.add(await agentAPI.onToolEvent((event) => {
      if (belongsToSession(event)) {
        dispatchToolEvent(event.toolEvent, callbacks);
      }
    }));
  }

  if (callbacks.onComplete) {
    subscriptions.add(await agentAPI.onDialogTurnCompleted((event) => {
      if (belongsToSession(event)) {
        callbacks.onComplete?.(event);
        subscriptions.dispose();
      }
    }));
  }

  return subscriptions;
};

export class AgentService {
  private static readonly sessionRegistry = new SessionRegistry();

  static async getOrCreateSession(
    agentType: string,
    workspacePath: string,
    modelName?: string
  ): Promise<string> {
    const existingSessionId = this.sessionRegistry.get(agentType, workspacePath);
    if (existingSessionId) {
      logger.debug(`Using existing session: ${existingSessionId}`);
      return existingSessionId;
    }

    logger.info(`Creating new session: ${agentType}`);

    try {
      const response = await agentAPI.createSession({
        sessionName: `${agentType}-session-${Date.now()}`,
        agentType,
        workspacePath,
        config: {
          modelName,
          enableTools: true,
          safeMode: true,
          autoCompact: true,
          enableContextCompression: true,
        }
      });

      this.sessionRegistry.set(agentType, workspacePath, response.sessionId);
      logger.info(`Session created: ${response.sessionId}`);
      return response.sessionId;
    } catch (error) {
      logger.error('Failed to create session', error);
      throw error;
    }
  }

  static async executeAgentTaskStream(
    request: AgentExecutionRequest,
    callbacks: AgentEventCallbacks
  ): Promise<string> {
    logger.info('Executing agent task flow', {
      agentType: request.agent_type,
      hasContext: Boolean(request.context)
    });

    try {
      const workspacePath = requireWorkspacePath(request);
      const sessionId = await this.getOrCreateSession(
        request.agent_type,
        workspacePath,
        request.model_name
      );

      await subscribeToSessionEvents(sessionId, callbacks);
      await agentAPI.startDialogTurn({
        sessionId,
        userInput: request.prompt,
        agentType: request.agent_type,
        workspacePath,
      });

      return sessionId;
    } catch (error) {
      logger.error('Agent task flow failed', error);
      callbacks.onError?.(error);
      throw error;
    }
  }

  static async cancelAgentTask(taskId: string): Promise<void> {
    try {
      await agentAPI.cancelSession(taskId);
      logger.info(`Task cancelled: ${taskId}`);
    } catch (error) {
      logger.error('Failed to cancel task', error);
      throw error;
    }
  }

  static async getAgentHealth(agentType: AgentType): Promise<AgentHealth> {
    return {
      healthy: true,
      name: this.getAgentDisplayName(agentType),
      description: this.getAgentDescription(agentType)
    };
  }

  static requiresSpecialVisualization(agentType: AgentType, metadata?: Record<string, any>): boolean {
    return (
      agentType === 'requirement_clarification' &&
      Array.isArray(metadata?.interactive_sections)
    );
  }

  private static getAgentDisplayName(agentType: AgentType): string {
    return i18nService.t(AGENT_TEXT_KEYS[agentType]?.name) || agentType;
  }

  private static getAgentDescription(agentType: AgentType): string {
    return (
      i18nService.t(AGENT_TEXT_KEYS[agentType]?.description) ||
      i18nService.t('common:agents.general.description')
    );
  }
}

export default AgentService;
