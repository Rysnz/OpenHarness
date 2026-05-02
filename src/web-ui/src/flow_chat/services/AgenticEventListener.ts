/**
 * Agentic event listener
 * Listens to backend agentic:// events and dispatches them to the frontend
 * 
 * Architecture:
 * - Uses unified agentAPI (based on ApiClient) for event listening
 * - ApiClient internally uses TransportAdapter, supporting multiple platforms
 */

import { agentAPI } from '@/infrastructure/api/service-api/AgentAPI';
import type { TextChunkEvent, ToolEvent, AgenticEvent, SessionTitleGeneratedEvent, ImageAnalysisEvent } from '@/infrastructure/api/service-api/AgentAPI';
import { createLogger } from '@/shared/utils/logger';

type UnlistenFn = () => void;

const logger = createLogger('AgenticEventListener');

export interface AgenticEventCallbacks {
  onSessionCreated?: (event: AgenticEvent) => void;
  onSessionDeleted?: (event: AgenticEvent) => void;
  onSessionStateChanged?: (event: AgenticEvent) => void;
  onImageAnalysisStarted?: (event: ImageAnalysisEvent) => void;
  onImageAnalysisCompleted?: (event: ImageAnalysisEvent) => void;
  onDialogTurnStarted?: (event: AgenticEvent) => void;
  onModelRoundStarted?: (event: AgenticEvent) => void;
  onTextChunk?: (event: TextChunkEvent) => void;
  onToolEvent?: (event: ToolEvent) => void;
  onDialogTurnCompleted?: (event: AgenticEvent) => void;
  onDialogTurnFailed?: (event: AgenticEvent) => void;
  onDialogTurnCancelled?: (event: AgenticEvent) => void;
  onTokenUsageUpdated?: (event: AgenticEvent) => void;
  onContextCompressionStarted?: (event: AgenticEvent) => void;
  onContextCompressionCompleted?: (event: AgenticEvent) => void;
  onContextCompressionFailed?: (event: AgenticEvent) => void;
  onSessionTitleGenerated?: (event: SessionTitleGeneratedEvent) => void;
}

type ListenerSpec<Event> = {
  callback?: (event: Event) => void;
  subscribe: (callback: (event: Event) => void) => UnlistenFn;
  debugMessage?: string;
  errorMessage?: string;
};

export class AgenticEventListener {
  private unlistenFunctions: UnlistenFn[] = [];
  private isListening = false;

  private addListener<Event>(spec: ListenerSpec<Event>): void {
    if (!spec.callback) {
      return;
    }

    const unlisten = spec.subscribe((event) => {
      if (spec.errorMessage) {
        logger.error(spec.errorMessage, event);
      } else if (spec.debugMessage) {
        logger.debug(spec.debugMessage, event);
      }
      spec.callback?.(event);
    });

    this.unlistenFunctions.push(unlisten);
  }

  async startListening(callbacks: AgenticEventCallbacks): Promise<void> {
    if (this.isListening) {
      logger.warn('Event listener already running');
      return;
    }

    logger.info('Starting Agentic event listener');

    try {
      this.addListener({ callback: callbacks.onSessionCreated, subscribe: agentAPI.onSessionCreated, debugMessage: 'Session created:' });
      this.addListener({ callback: callbacks.onSessionDeleted, subscribe: agentAPI.onSessionDeleted, debugMessage: 'Session deleted:' });
      this.addListener({ callback: callbacks.onSessionStateChanged, subscribe: agentAPI.onSessionStateChanged, debugMessage: 'Session state changed:' });
      this.addListener({ callback: callbacks.onImageAnalysisStarted, subscribe: agentAPI.onImageAnalysisStarted, debugMessage: 'Image analysis started:' });
      this.addListener({ callback: callbacks.onImageAnalysisCompleted, subscribe: agentAPI.onImageAnalysisCompleted, debugMessage: 'Image analysis completed:' });
      this.addListener({ callback: callbacks.onDialogTurnStarted, subscribe: agentAPI.onDialogTurnStarted, debugMessage: 'Dialog turn started:' });
      this.addListener({ callback: callbacks.onModelRoundStarted, subscribe: agentAPI.onModelRoundStarted, debugMessage: 'Model round started:' });
      this.addListener({ callback: callbacks.onTextChunk, subscribe: agentAPI.onTextChunk });
      this.addListener({ callback: callbacks.onToolEvent, subscribe: agentAPI.onToolEvent });
      this.addListener({ callback: callbacks.onDialogTurnCompleted, subscribe: agentAPI.onDialogTurnCompleted, debugMessage: 'Dialog turn completed:' });
      this.addListener({ callback: callbacks.onDialogTurnFailed, subscribe: agentAPI.onDialogTurnFailed, errorMessage: 'Dialog turn failed:' });
      this.addListener({ callback: callbacks.onDialogTurnCancelled, subscribe: agentAPI.onDialogTurnCancelled, debugMessage: 'Dialog turn cancelled:' });
      this.addListener({ callback: callbacks.onTokenUsageUpdated, subscribe: agentAPI.onTokenUsageUpdated, debugMessage: 'Token usage updated:' });
      this.addListener({ callback: callbacks.onContextCompressionStarted, subscribe: agentAPI.onContextCompressionStarted, debugMessage: 'Context compression started:' });
      this.addListener({ callback: callbacks.onContextCompressionCompleted, subscribe: agentAPI.onContextCompressionCompleted, debugMessage: 'Context compression completed:' });
      this.addListener({ callback: callbacks.onContextCompressionFailed, subscribe: agentAPI.onContextCompressionFailed, errorMessage: 'Context compression failed:' });
      this.addListener({ callback: callbacks.onSessionTitleGenerated, subscribe: agentAPI.onSessionTitleGenerated, debugMessage: 'Session title generated:' });

      this.isListening = true;
      logger.info(`Registered ${this.unlistenFunctions.length} event listeners`);
    } catch (error) {
      logger.error('Failed to register event listeners:', error);
      await this.stopListening();
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isListening) {
      return;
    }

    logger.info('Stopping Agentic event listener');

    for (const unlisten of this.unlistenFunctions) {
      try {
        unlisten();
      } catch (error) {
        logger.error('Failed to unlisten:', error);
      }
    }

    this.unlistenFunctions = [];
    this.isListening = false;
    logger.info('Stopped all event listeners');
  }

  getIsListening(): boolean {
    return this.isListening;
  }
}

export const agenticEventListener = new AgenticEventListener();

