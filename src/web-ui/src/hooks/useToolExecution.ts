import { useState, useEffect, useCallback } from 'react';
import { ToolExecutionService } from '../shared/services/tool-execution-service';
import { ToolDisplayMessage, ToolExecutionInfo } from '../shared/types/tool-display';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('useToolExecution');
const DEFAULT_EVENT_TYPES = ['all'];
const INVALID_TOOL_MESSAGE_IDS = new Set(['tool_exec_undefined', 'tool_result_undefined']);

export interface UseToolExecutionOptions {
  autoConnect?: boolean;
  eventTypes?: string[];
  maxMessages?: number;
}

export interface UseToolExecutionReturn {
  toolMessages: ToolDisplayMessage[];
  activeExecutions: ToolExecutionInfo[];
  hasActiveExecutions: boolean;
  clearToolMessages: () => void;
  addToolMessage: (message: ToolDisplayMessage) => void;
}

const isValidToolMessage = (message: ToolDisplayMessage): boolean =>
  !!message.id && !INVALID_TOOL_MESSAGE_IDS.has(message.id);

const appendUniqueMessage = (
  messages: ToolDisplayMessage[],
  message: ToolDisplayMessage,
  maxMessages?: number
): ToolDisplayMessage[] => {
  if (messages.some((item) => item.id === message.id)) {
    return messages;
  }

  const nextMessages = [...messages, message];
  return maxMessages && nextMessages.length > maxMessages
    ? nextMessages.slice(-maxMessages)
    : nextMessages;
};

export const useToolExecution = (
  options: UseToolExecutionOptions = {}
): UseToolExecutionReturn => {
  const {
    autoConnect = true,
    eventTypes = DEFAULT_EVENT_TYPES,
    maxMessages = 50
  } = options;

  const [toolMessages, setToolMessages] = useState<ToolDisplayMessage[]>([]);
  const [activeExecutions, setActiveExecutions] = useState<ToolExecutionInfo[]>([]);

  const handleToolEvent = useCallback((message: ToolDisplayMessage) => {
    if (!isValidToolMessage(message)) {
      log.warn('Ignoring invalid tool message', { messageId: message.id });
      return;
    }

    setToolMessages((prev) => appendUniqueMessage(prev, message, maxMessages));

    if (message.type === 'tool_use' || message.toolExecution) {
      const service = ToolExecutionService.getInstance();
      setActiveExecutions(service.getActiveExecutions());
    }
  }, [maxMessages]);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }

    const service = ToolExecutionService.getInstance();
    const cleanupFunctions = eventTypes.map((eventType) =>
      service.onToolEvent(eventType, handleToolEvent)
    );

    setActiveExecutions(service.getActiveExecutions());

    return () => {
      cleanupFunctions.forEach((cleanup) => cleanup());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  const clearToolMessages = useCallback(() => {
    setToolMessages([]);
  }, []);

  const addToolMessage = useCallback((message: ToolDisplayMessage) => {
    setToolMessages((prev) => appendUniqueMessage(prev, message));
  }, []);

  const hasActiveExecutions = activeExecutions.length > 0;

  return {
    toolMessages,
    activeExecutions,
    hasActiveExecutions,
    clearToolMessages,
    addToolMessage
  };
};
