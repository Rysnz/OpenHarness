import { Component, type CSSProperties, type ReactNode } from 'react';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { buildReactCrashLogPayload } from '@/shared/utils/reactProductionError';

const log = createLogger('AppErrorBoundary');

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: unknown;
}

const shellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  height: '100vh',
  padding: 24,
  color: '#e5e7eb',
  background: '#0b0f14',
};

const panelStyle: CSSProperties = {
  width: '100%',
  maxWidth: 760,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
};

const messageStyle: CSSProperties = {
  margin: '12px 0 0',
  opacity: 0.9,
};

const actionRowStyle: CSSProperties = {
  marginTop: 16,
};

const reloadButtonStyle: CSSProperties = {
  padding: '8px 12px',
  color: '#fff',
  background: '#2563eb',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

const detailsStyle: CSSProperties = {
  marginTop: 16,
};

const summaryStyle: CSSProperties = {
  cursor: 'pointer',
};

const stackStyle: CSSProperties = {
  maxHeight: 240,
  marginTop: 12,
  padding: 12,
  overflow: 'auto',
  color: '#cbd5e1',
  fontSize: 12,
  background: '#0f172a',
  borderRadius: 8,
};

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    this.setState({ error, errorInfo });
    log.error('[CRASH] React error boundary caught exception', buildReactCrashLogPayload(error, errorInfo));
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const copy = errorBoundaryCopy(this.state.error);

    return (
      <div style={shellStyle}>
        <div style={panelStyle}>
          <h2 style={titleStyle}>{copy.title}</h2>
          <p style={messageStyle}>{copy.firstLine}</p>
          <div style={actionRowStyle}>
            <button onClick={this.handleReload} style={reloadButtonStyle}>
              {copy.reloadLabel}
            </button>
          </div>
          {import.meta.env.DEV && this.state.error && (
            <details style={detailsStyle}>
              <summary style={summaryStyle}>{copy.technicalDetails}</summary>
              <pre style={stackStyle}>
                {this.state.error.stack ?? this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

function errorBoundaryCopy(error?: Error) {
  const unknownError = i18nService.t('errors:boundary.unknown');
  return {
    title: i18nService.t('errors:boundary.title'),
    reloadLabel: i18nService.t('errors:boundary.reload'),
    technicalDetails: i18nService.t('errors:boundary.technicalDetails'),
    firstLine: error?.message?.split('\n')[0] ?? unknownError,
  };
}

export default AppErrorBoundary;
