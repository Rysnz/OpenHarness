import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { CompactToolCard, CompactToolCardHeader } from '../tool-cards/CompactToolCard';
import type { FlowToolItem } from '../types/flow-chat';
import { createLogger } from '@/shared/utils/logger';
import {
  buildReactCrashLogPayload,
  safeReactErrorInfo,
} from '@/shared/utils/reactProductionError';

const log = createLogger('FlowToolCardErrorBoundary');
const DETAIL_PREVIEW_LIMIT = 4000;

const fallbackGridStyle = {
  display: 'grid',
  gap: 12,
} as const;

const messageStyle = {
  color: 'var(--tool-card-text-secondary)',
  fontSize: 12,
  lineHeight: 1.5,
} as const;

const retryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid var(--tool-card-border, rgba(255, 255, 255, 0.12))',
  background: 'var(--tool-card-bg-secondary, rgba(255, 255, 255, 0.04))',
  color: 'var(--tool-card-text-primary)',
  cursor: 'pointer',
} as const;

const detailsSummaryStyle = { cursor: 'pointer' } as const;

const previewBlockStyle = {
  marginTop: 8,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontSize: 12,
  maxHeight: 220,
  overflow: 'auto',
} as const;

const technicalBlockStyle = {
  ...previewBlockStyle,
  maxHeight: 260,
} as const;

interface Props {
  children: ReactNode;
  toolItem: FlowToolItem;
  displayName: string;
  sessionId?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: unknown;
}

function truncateDetail(text: string, maxLength: number = DETAIL_PREVIEW_LIMIT): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}\n...`;
}

function safeSerialize(value: unknown): string {
  try {
    return truncateDetail(JSON.stringify(value, null, 2));
  } catch (error) {
    return `Failed to serialize payload: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function getFirstLine(error?: Error): string {
  const message = error?.message?.trim();
  if (!message) {
    return 'Tool card render failed.';
  }

  return message.split('\n')[0] || 'Tool card render failed.';
}

function getToolCardId(toolItem: FlowToolItem): string {
  return toolItem.id ?? toolItem.toolCall?.id ?? 'unknown-tool-id';
}

function getTechnicalDetails(error: Error | undefined, errorInfo: unknown): string {
  const componentStack = safeReactErrorInfo(errorInfo).componentStack;
  return truncateDetail(
    [error?.stack || error?.message, componentStack]
      .filter(Boolean)
      .join('\n\n')
  );
}

function ErrorDetails({ error, errorInfo }: { error?: Error; errorInfo?: unknown }) {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <details>
      <summary style={detailsSummaryStyle}>Technical details</summary>
      <pre style={technicalBlockStyle}>
        {getTechnicalDetails(error, errorInfo)}
      </pre>
    </details>
  );
}

function RenderFallback({
  displayName,
  error,
  errorInfo,
  onRetry,
  toolItem,
}: {
  displayName: string;
  error?: Error;
  errorInfo?: unknown;
  onRetry: () => void;
  toolItem: FlowToolItem;
}) {
  const toolId = getToolCardId(toolItem);

  return (
    <div data-tool-card-id={toolId} role="alert">
      <CompactToolCard
        status="error"
        isExpanded={true}
        header={(
          <CompactToolCardHeader
            statusIcon={<AlertTriangle size={12} />}
            action={displayName}
            content="Tool card render failed"
          />
        )}
        expandedContent={(
          <div style={fallbackGridStyle}>
            <div style={messageStyle}>
              {getFirstLine(error)}
            </div>

            <div>
              <button
                onClick={onRetry}
                style={retryButtonStyle}
                type="button"
              >
                <RefreshCw size={12} />
                Retry render
              </button>
            </div>

            <details>
              <summary style={detailsSummaryStyle}>Raw tool payload</summary>
              <pre style={previewBlockStyle}>
                {safeSerialize(toolItem)}
              </pre>
            </details>

            <ErrorDetails error={error} errorInfo={errorInfo} />
          </div>
        )}
      />
    </div>
  );
}

export class FlowToolCardErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    this.setState({ error, errorInfo });
    log.error('[CRASH] Flow tool card render failed', {
      sessionId: this.props.sessionId,
      toolId: this.props.toolItem.id,
      toolName: this.props.toolItem.toolName,
      toolStatus: this.props.toolItem.status,
      ...buildReactCrashLogPayload(error, errorInfo),
    });
  }

  componentDidUpdate(prevProps: Props) {
    if (!this.state.hasError) {
      return;
    }

    if (this.shouldResetForNewToolState(prevProps)) {
      this.clearError();
    }
  }

  private handleRetry = () => {
    this.clearError();
  };

  private shouldResetForNewToolState(prevProps: Props): boolean {
    const previous = prevProps.toolItem;
    const current = this.props.toolItem;

    return previous.id !== current.id ||
      previous.status !== current.status ||
      previous.toolResult !== current.toolResult ||
      previous.partialParams !== current.partialParams ||
      previous.userConfirmed !== current.userConfirmed;
  }

  private clearError(): void {
    this.setState({
      hasError: false,
      error: undefined,
      errorInfo: undefined,
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <RenderFallback
        displayName={this.props.displayName}
        error={this.state.error}
        errorInfo={this.state.errorInfo}
        onRetry={this.handleRetry}
        toolItem={this.props.toolItem}
      />
    );
  }
}

export default FlowToolCardErrorBoundary;
