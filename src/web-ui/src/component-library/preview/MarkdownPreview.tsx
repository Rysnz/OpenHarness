/**
 * Markdown preview page
 */

import React, { useState } from 'react';
import { Markdown } from '@components/Markdown';
import { Button } from '@components/Button';
import { useI18n } from '@/infrastructure/i18n';
import './markdown-preview.css';

type MarkdownVariant = 'default' | 'bordered' | 'minimal';
type MarkdownMode = 'preview' | 'edit';

export const MarkdownPreview: React.FC = () => {
  const { t } = useI18n('components');
  const getSampleMarkdown = () => t('componentLibrary.markdownPreview.sample');
  const [content, setContent] = useState(() => getSampleMarkdown());
  const [variant, setVariant] = useState<MarkdownVariant>('default');
  const [activeTab, setActiveTab] = useState<MarkdownMode>('preview');
  const variantOptions: MarkdownVariant[] = ['default', 'bordered', 'minimal'];
  const modeOptions: MarkdownMode[] = ['preview', 'edit'];

  return (
    <div className="markdown-preview-page">
      <header className="markdown-preview-header">
        <div className="header-left">
          <h1>{t('componentLibrary.markdownPreview.title')}</h1>
          <span className="badge">{t('componentLibrary.markdownPreview.badge')}</span>
        </div>
        <div className="header-right">
          <Button
            variant="ghost"
            size="small"
            onClick={() => window.location.href = '/preview.html'}
          >
            {t('componentLibrary.markdownPreview.backToLibrary')}
          </Button>
        </div>
      </header>

      <div className="markdown-controls">
        <div className="control-group">
          <label>{t('componentLibrary.markdownPreview.controls.variantLabel')}</label>
          <div className="button-group">
            {variantOptions.map((option) => (
              <Button
                key={option}
                variant={variant === option ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setVariant(option)}
              >
                {t(`componentLibrary.markdownPreview.variants.${option}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label>{t('componentLibrary.markdownPreview.controls.modeLabel')}</label>
          <div className="button-group">
            {modeOptions.map((option) => (
              <Button
                key={option}
                variant={activeTab === option ? 'primary' : 'secondary'}
                size="small"
                onClick={() => setActiveTab(option)}
              >
                {t(`componentLibrary.markdownPreview.controls.${option}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <Button
            variant="ghost"
            size="small"
            onClick={() => setContent(getSampleMarkdown())}
          >
            {t('componentLibrary.markdownPreview.controls.reset')}
          </Button>
        </div>
      </div>

      <div className="markdown-preview-main">
        {activeTab === 'preview' ? (
          <div className="preview-container">
            <Markdown content={content} variant={variant} />
          </div>
        ) : (
          <div className="editor-container">
            <textarea
              className="markdown-editor"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('componentLibrary.markdownPreview.editorPlaceholder')}
            />
          </div>
        )}
      </div>
    </div>
  );
};
