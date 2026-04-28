/**
 * References panel shown as a floating overlay.
 */

import React, { useCallback, useMemo } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { FileText, X, ChevronRight } from 'lucide-react';
import { createLogger } from '@/shared/utils/logger';
import { IconButton } from '@/component-library';
import { useI18n } from '@/infrastructure/i18n';
import './ReferencesPanel.scss';

const log = createLogger('ReferencesPanel');

const PANEL_WIDTH = 500;
const VIEWPORT_MARGIN = 20;
const CONTAINER_CLASS = 'references-panel-container';

type Translate = ReturnType<typeof useI18n>['t'];

export interface ReferenceLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  /** Optional line preview text. */
  text?: string;
}

interface GroupedReferences {
  filePath: string;
  fileName: string;
  references: Array<{
    location: ReferenceLocation;
    lineNumber: number;
    preview: string;
  }>;
}

export interface ReferencesPanelProps {
  /** Reference locations to render. */
  references: ReferenceLocation[];
  /** Symbol name used for the query (optional). */
  symbolName?: string;
  /** Panel anchor position (viewport coords). */
  position: { x: number; y: number };
  /** Close callback. */
  onClose: () => void;
  /** Click callback for a single reference entry. */
  onReferenceClick: (reference: ReferenceLocation) => void;
  /** Max panel height in px. */
  maxHeight?: number;
}

function extractFileName(uri: string): string {
  const match = uri.match(/[^/\\]+$/);
  return match ? match[0] : uri;
}

function groupReferences(
  references: ReferenceLocation[],
  t: Translate
): GroupedReferences[] {
  const groups = new Map<string, GroupedReferences>();

  for (const location of references) {
    const filePath = location.uri;
    const fileName = extractFileName(filePath);
    const group =
      groups.get(filePath) ??
      {
        filePath,
        fileName,
        references: [],
      };

    group.references.push({
      location,
      lineNumber: location.range.start.line + 1,
      preview: location.text || t('lsp.referencesPanel.previewFallback'),
    });
    groups.set(filePath, group);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      references: [...group.references].sort((a, b) => a.lineNumber - b.lineNumber),
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

function resolvePanelStyle(
  position: ReferencesPanelProps['position'],
  maxHeight: number
): React.CSSProperties {
  const style: React.CSSProperties = {
    maxHeight: `${maxHeight}px`,
  };

  if (position.x + PANEL_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
    style.right = `${window.innerWidth - position.x}px`;
  } else {
    style.left = `${position.x}px`;
  }

  if (position.y + maxHeight > window.innerHeight - VIEWPORT_MARGIN) {
    style.bottom = `${window.innerHeight - position.y}px`;
  } else {
    style.top = `${position.y}px`;
  }

  return style;
}

function panelTitle(references: ReferenceLocation[], symbolName: string | undefined, t: Translate) {
  const title = symbolName
    ? t('lsp.referencesPanel.titleWithSymbol', { symbol: symbolName })
    : t('lsp.referencesPanel.title');

  return (
    <>
      {title}
      <span className="references-panel__count">({references.length})</span>
    </>
  );
}

function emptyMessage(symbolName: string | undefined, t: Translate): string {
  return symbolName
    ? t('lsp.referencesPanel.emptyWithSymbol', { symbol: symbolName })
    : t('lsp.referencesPanel.emptyDescription');
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <IconButton
      className="references-panel__close"
      onClick={onClose}
      size="small"
      variant="ghost"
    >
      <X size={16} />
    </IconButton>
  );
}

function ReferencesHeader({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="references-panel__header">
      <div className="references-panel__title">
        <FileText size={16} />
        <span>{children}</span>
      </div>
      <CloseButton onClose={onClose} />
    </div>
  );
}

function ReferenceGroupView({
  group,
  onReferenceClick,
  emptyLineLabel,
}: {
  group: GroupedReferences;
  onReferenceClick: (reference: ReferenceLocation) => void;
  emptyLineLabel: string;
}) {
  return (
    <div className="references-panel__file-group">
      <div className="references-panel__file-header" title={group.filePath}>
        <FileText size={14} />
        <div className="references-panel__file-path">
          {group.filePath.replace(/^file:\/\/\//, '')}
        </div>
        <div className="references-panel__file-count">{group.references.length}</div>
      </div>

      <div className="references-panel__reference-list">
        {group.references.map((reference, index) => (
          <div
            key={`${group.filePath}-${index}`}
            className="references-panel__reference-item"
            onClick={() => onReferenceClick(reference.location)}
          >
            <ChevronRight size={14} className="references-panel__reference-icon" />
            <div className="references-panel__reference-line">
              {reference.lineNumber}
            </div>
            <div className="references-panel__reference-preview">
              {reference.preview.trim() || emptyLineLabel}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ReferencesPanel: React.FC<ReferencesPanelProps> = ({
  references,
  symbolName,
  position,
  onClose,
  onReferenceClick,
  maxHeight = 400,
}) => {
  const { t } = useI18n('tools');
  const groupedReferences = useMemo(
    () => groupReferences(references, t),
    [references, t]
  );
  const panelStyle = useMemo(
    () => resolvePanelStyle(position, maxHeight),
    [position, maxHeight]
  );
  const handleReferenceClick = useCallback(
    (ref: ReferenceLocation) => onReferenceClick(ref),
    [onReferenceClick]
  );

  if (references.length === 0) {
    return (
      <div className="references-panel" style={panelStyle}>
        <ReferencesHeader onClose={onClose}>
          {t('lsp.referencesPanel.emptyTitle')}
        </ReferencesHeader>
        <div className="references-panel__empty">
          {emptyMessage(symbolName, t)}
        </div>
      </div>
    );
  }

  return (
    <div className="references-panel" style={panelStyle}>
      <ReferencesHeader onClose={onClose}>
        {panelTitle(references, symbolName, t)}
      </ReferencesHeader>

      <div className="references-panel__content">
        {groupedReferences.map((group) => (
          <ReferenceGroupView
            key={group.filePath}
            group={group}
            onReferenceClick={handleReferenceClick}
            emptyLineLabel={t('lsp.referencesPanel.emptyLine')}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * References Panel Controller
 * Creates and manages the panel under document.body.
 */
export class ReferencesPanelController {
  private container: HTMLDivElement | null = null;
  private root: Root | null = null;

  /**
   * Show the references panel.
   */
  show(
    references: ReferenceLocation[],
    position: { x: number; y: number },
    options: {
      symbolName?: string;
      onReferenceClick: (ref: ReferenceLocation) => void;
    }
  ): void {
    this.ensureContainer();

    if (this.root) {
      this.root.render(
        <ReferencesPanel
          references={references}
          symbolName={options.symbolName}
          position={position}
          onClose={() => this.hide()}
          onReferenceClick={options.onReferenceClick}
        />
      );
    } else {
      log.error('Root is null, cannot render');
    }
  }

  private ensureContainer(): void {
    if (this.container) {
      return;
    }

    this.container = document.createElement('div');
    this.container.className = CONTAINER_CLASS;
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '99999',
    });

    document.body.appendChild(this.container);
    this.root = createRoot(this.container);
    document.addEventListener('mousedown', this.handleOutsideClick);
    document.addEventListener('keydown', this.handleEscapeKey);
  }

  /**
   * Close when clicking outside.
   */
  private handleOutsideClick = (event: MouseEvent) => {
    if (this.container && !this.container.contains(event.target as Node)) {
      this.hide();
    }
  };

  /**
   * Close on Escape.
   */
  private handleEscapeKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.hide();
    }
  };

  /**
   * Hide the panel.
   */
  hide(): void {
    document.removeEventListener('mousedown', this.handleOutsideClick);
    document.removeEventListener('keydown', this.handleEscapeKey);

    if (this.root) {
      this.root.unmount();
      this.root = null;
    }

    if (this.container) {
      document.body.removeChild(this.container);
      this.container = null;
    }
  }

  /**
   * Whether the panel is currently visible.
   */
  isVisible(): boolean {
    return this.container !== null;
  }
}
