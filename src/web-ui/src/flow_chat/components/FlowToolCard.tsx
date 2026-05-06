import React from 'react';
import { getToolCardConfig, getToolCardComponent } from '../tool-cards';
import type { FlowToolItem } from '../types/flow-chat';
import { createLogger } from '@/shared/utils/logger';
import { FlowToolCardErrorBoundary } from './FlowToolCardErrorBoundary';

const log = createLogger('FlowToolCard');

interface FlowToolCardProps {
  toolItem: FlowToolItem;
  onConfirm?: (toolId: string, updatedInput?: any) => void;
  onReject?: (toolId: string) => void;
  onOpenInEditor?: (filePath: string) => void;
  onOpenInPanel?: (panelType: string, data: any) => void;
  onExpand?: (toolId: string) => void;
  sessionId?: string;
  className?: string;
}

const progressMessage = (toolItem: FlowToolItem): unknown => (toolItem as any)._progressMessage;

const shouldReuseToolCard = (prevProps: FlowToolCardProps, nextProps: FlowToolCardProps): boolean =>
  prevProps.toolItem.id === nextProps.toolItem.id &&
  prevProps.toolItem.status === nextProps.toolItem.status &&
  prevProps.toolItem.terminalSessionId === nextProps.toolItem.terminalSessionId &&
  prevProps.toolItem.userConfirmed === nextProps.toolItem.userConfirmed &&
  prevProps.toolItem.isParamsStreaming === nextProps.toolItem.isParamsStreaming &&
  progressMessage(prevProps.toolItem) === progressMessage(nextProps.toolItem) &&
  prevProps.toolItem.partialParams === nextProps.toolItem.partialParams &&
  prevProps.toolItem.toolResult === nextProps.toolItem.toolResult;

export const FlowToolCard: React.FC<FlowToolCardProps> = React.memo(({
  toolItem,
  onConfirm,
  onReject,
  onOpenInEditor,
  onOpenInPanel,
  onExpand,
  sessionId,
  className = ''
}) => {
  const config = getToolCardConfig(toolItem.toolName);
  const CardComponent = getToolCardComponent(toolItem.toolName);

  const handleConfirm = React.useCallback((updatedInput?: any) => {
    log.debug('handleConfirm called', {
      toolId: toolItem.id,
      toolName: toolItem.toolName,
      hasUpdatedInput: updatedInput !== undefined,
      updatedInputKeys: updatedInput ? Object.keys(updatedInput) : []
    });
    onConfirm?.(toolItem.id, updatedInput);
  }, [toolItem.id, toolItem.toolName, onConfirm]);

  const handleReject = React.useCallback(() => {
    onReject?.(toolItem.id);
  }, [toolItem.id, onReject]);

  const handleExpand = React.useCallback(() => {
    onExpand?.(toolItem.id);
  }, [toolItem.id, onExpand]);

  return (
    <div className={`flow-tool-card-wrapper ${className}`}>
      <FlowToolCardErrorBoundary
        toolItem={toolItem}
        displayName={config.displayName}
        sessionId={sessionId}
      >
        <CardComponent
          toolItem={toolItem}
          config={config}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onOpenInEditor={onOpenInEditor}
          onOpenInPanel={onOpenInPanel}
          onExpand={handleExpand}
          sessionId={sessionId}
        />
      </FlowToolCardErrorBoundary>
    </div>
  );
}, shouldReuseToolCard);
