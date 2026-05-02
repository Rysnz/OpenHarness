/**
 * Read-only Code Block Component
 * 
 * Used for chat code blocks, documentation preview, code display.
 * Based on MonacoEditorCore with readonly preset.
 * @module components/ReadOnlyCodeBlock
 */

import React, { useMemo, useRef, useCallback } from 'react';
import { MonacoEditorCore, type MonacoEditorCoreRef } from '../../core/MonacoEditorCore';
import type { EditorConfigPartial } from '../../config/types';
import { getMonacoLanguage } from '@/infrastructure/language-detection';
import './ReadOnlyCodeBlock.scss';

const DEFAULT_MAX_HEIGHT = 400;
const DEFAULT_MIN_HEIGHT = 50;
const DEFAULT_FONT_SIZE = 14;
const DEFAULT_LINE_HEIGHT = 1.5;
const CONTENT_VERTICAL_PADDING = 16;

export interface ReadOnlyCodeBlockProps {
  /** Code content */
  content: string;
  /** Language (auto-detect if not specified) */
  language?: string;
  /** File name (for language detection) */
  fileName?: string;
  /** Show line numbers */
  showLineNumbers?: boolean;
  /** Max height (scrolls when exceeded) */
  maxHeight?: number | string;
  /** Min height */
  minHeight?: number | string;
  /** Auto-adjust height based on content */
  autoHeight?: boolean;
  /** Theme ID */
  theme?: string;
  /** CSS class name */
  className?: string;
  /** Inline styles */
  style?: React.CSSProperties;
  /** Config overrides */
  config?: EditorConfigPartial;
  /** Click handler */
  onClick?: () => void;
  /** Editor ready callback */
  onReady?: (ref: MonacoEditorCoreRef) => void;
}

function resolveLanguage(language?: string, fileName?: string): string {
  if (language) return language;
  if (!fileName) return 'plaintext';

  const detected = getMonacoLanguage(fileName);
  return detected === 'plaintext' ? 'plaintext' : detected;
}

function parseDimension(value: number | string, fallback: number): number {
  return typeof value === 'number' ? value : parseInt(String(value), 10) || fallback;
}

function buildReadonlyFilePath(fileName?: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const ext = fileName ? fileName.split('.').pop() : 'txt';
  return `inmemory://readonly/${timestamp}/${random}/code.${ext}`;
}

export const ReadOnlyCodeBlock: React.FC<ReadOnlyCodeBlockProps> = ({
  content,
  language,
  fileName,
  showLineNumbers = true,
  maxHeight = 400,
  minHeight = 50,
  autoHeight = true,
  theme,
  className = '',
  style,
  config,
  onClick,
  onReady,
}) => {
  const editorRef = useRef<MonacoEditorCoreRef>(null);
  
  const detectedLanguage = useMemo(() => resolveLanguage(language, fileName), [language, fileName]);
  
  const filePath = useMemo(() => buildReadonlyFilePath(fileName), [fileName]);
  
  const computedHeight = useMemo(() => {
    if (!autoHeight) {
      return typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;
    }
    
    const lineCount = content.split('\n').length;
    const lineHeight = config?.lineHeight || DEFAULT_LINE_HEIGHT;
    const fontSize = config?.fontSize || DEFAULT_FONT_SIZE;
    const calculatedHeight = lineCount * fontSize * lineHeight + CONTENT_VERTICAL_PADDING;
    
    const minH = parseDimension(minHeight, DEFAULT_MIN_HEIGHT);
    const maxH = parseDimension(maxHeight, DEFAULT_MAX_HEIGHT);
    
    const finalHeight = Math.min(Math.max(calculatedHeight, minH), maxH);
    return `${finalHeight}px`;
  }, [content, autoHeight, minHeight, maxHeight, config]);
  
  const handleEditorReady = useCallback(() => {
    if (onReady && editorRef.current) {
      onReady(editorRef.current);
    }
  }, [onReady]);
  
  const mergedConfig: EditorConfigPartial = useMemo(() => ({
    ...config,
    minimap: { enabled: false, side: 'right', size: 'proportional' },
    scrollBeyondLastLine: false,
  }), [config]);
  
  return (
    <div
      className={`readonly-code-block ${className}`}
      style={{
        height: computedHeight,
        ...style,
      }}
      onClick={onClick}
    >
      <MonacoEditorCore
        ref={editorRef}
        filePath={filePath}
        language={detectedLanguage}
        initialContent={content}
        preset="readonly"
        config={mergedConfig}
        readOnly={true}
        showLineNumbers={showLineNumbers}
        showMinimap={false}
        theme={theme}
        onEditorReady={handleEditorReady}
      />
    </div>
  );
};

export default ReadOnlyCodeBlock;
