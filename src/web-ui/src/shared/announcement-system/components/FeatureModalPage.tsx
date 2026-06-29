import React from 'react';
import DOMPurify from 'dompurify';
import type { Config as DOMPurifyConfig } from 'dompurify';
import type { ModalPage } from '../types';
import MediaRenderer from './MediaRenderer';
import { useAnnouncementI18n } from '../hooks/useAnnouncementI18n';

const ANNOUNCEMENT_KEY_PREFIX = 'announcements.';

/// DOMPurify allow-list — only safe formatting tags and attributes
const PURIFY_CONFIG: DOMPurifyConfig = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4',
    'img', 'span', 'div',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'class',
  ],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
};

/**
 * Sanitize a raw HTML string through DOMPurify.
 * Strips script tags, event handlers, data-* attrs, javascript: URIs etc.
 */
const sanitizeHtml = (html: string): string =>
  DOMPurify.sanitize(html, PURIFY_CONFIG) as unknown as string;

interface FeatureModalPageProps {
  page: ModalPage;
  active: boolean;
}

const FeatureModalPage: React.FC<FeatureModalPageProps> = ({ page, active }) => {
  const { t } = useAnnouncementI18n();
  const resolveText = (key: string) => (key.startsWith(ANNOUNCEMENT_KEY_PREFIX) ? t(key) : key);

  // Sanitize before injecting — prevents XSS via announcement body
  const safeBodyHtml = sanitizeHtml(renderAnnouncementBody(resolveText(page.body)));

  return (
    <div className={`feature-modal-page feature-modal-page--${page.layout}`}>
      {page.media && (
        <div className="feature-modal-page__media">
          <MediaRenderer media={page.media} active={active} />
        </div>
      )}
      <div className="feature-modal-page__text">
        <div className="feature-modal-page__eyebrow" aria-hidden />
        <h2 className="feature-modal-page__title">{resolveText(page.title)}</h2>
        <div className="feature-modal-page__rule" aria-hidden />
        <div
          className="feature-modal-page__body"
          dangerouslySetInnerHTML={{ __html: safeBodyHtml }}
        />
      </div>
    </div>
  );
};

export default FeatureModalPage;

function renderAnnouncementBody(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => renderMarkdownBlock(block.trim()))
    .join('\n');
}

function renderMarkdownBlock(block: string): string {
  const lines = block.split('\n');

  if (isTableBlock(lines)) {
    return renderTable(lines);
  }

  return `<p>${lines.map(inlineMarkdown).join('<br>')}</p>`;
}

function isTableBlock(lines: string[]): boolean {
  return lines.length >= 2 && lines.some(isSeparatorRow);
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s|:-]+\|$/.test(line.trim());
}

function renderTable(lines: string[]): string {
  const rows = lines.filter((line) => !isSeparatorRow(line));
  const [header, ...bodyRows] = rows;

  return [
    '<table class="md-table">',
    `<thead><tr>${renderCells(header, 'th')}</tr></thead>`,
    `<tbody>${bodyRows.map((row) => `<tr>${renderCells(row, 'td')}</tr>`).join('')}</tbody>`,
    '</table>',
  ].join('');
}

function renderCells(row: string, tag: 'th' | 'td'): string {
  return row
    .split('|')
    .filter((_, index, cells) => index > 0 && index < cells.length - 1)
    .map((cell) => `<${tag}>${inlineMarkdown(cell.trim())}</${tag}>`)
    .join('');
}

function inlineMarkdown(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
