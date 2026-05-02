import React from 'react';
import { Code2 } from 'lucide-react';
import type { WebElementContext, ValidationResult, RenderOptions } from '../../../types/context';
import type {
  ContextTransformer,
  ContextValidator,
  ContextCardRenderer,
} from '../../../services/ContextRegistry';
import { i18nService } from '@/infrastructure/i18n';

const MAX_VISIBLE_ATTRIBUTES = 6;
const SOURCE_URL_LIMIT = 40;
const CSS_PATH_TAIL_LIMIT = 60;
const ATTRIBUTE_VALUE_LIMIT = 20;
const TEXT_PREVIEW_LIMIT = 80;

function clipTail(value: string, maxLength: number): string {
  return value.length > maxLength ? `...${value.slice(-maxLength)}` : value;
}

function clipHead(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function webElementPayload(context: WebElementContext) {
  return {
    type: 'web-element',
    id: context.id,
    tag_name: context.tagName,
    path: context.path,
    attributes: context.attributes,
    text_content: context.textContent,
    outer_html: context.outerHTML,
    source_url: context.sourceUrl ?? null,
  };
}

export class WebElementContextTransformer implements ContextTransformer<'web-element'> {
  readonly type = 'web-element' as const;

  transform(context: WebElementContext): unknown {
    return webElementPayload(context);
  }

  estimateSize(context: WebElementContext): number {
    const attributeSize = JSON.stringify(context.attributes).length;
    const optionalTextSize = context.textContent?.length ?? 0;

    return context.path.length + context.outerHTML.length + attributeSize + optionalTextSize;
  }
}

export class WebElementContextValidator implements ContextValidator<'web-element'> {
  readonly type = 'web-element' as const;

  async validate(context: WebElementContext): Promise<ValidationResult> {
    if (!context.tagName) {
      return { valid: false, error: 'Web element must have a tag name.' };
    }

    if (!context.path) {
      return { valid: false, error: 'Web element must have a CSS path.' };
    }

    return { valid: true };
  }
}

export class WebElementCardRenderer implements ContextCardRenderer<'web-element'> {
  readonly type = 'web-element' as const;

  render(context: WebElementContext, options?: RenderOptions): React.ReactElement {
    const compact = options?.compact ?? false;
    const attrEntries = Object.entries(context.attributes).slice(0, MAX_VISIBLE_ATTRIBUTES);

    return (
      <div className="context-card web-element-context-card" data-compact={compact}>
        <div className="context-card__header">
          <div className="context-card__icon">
            <Code2 size={16} />
          </div>
          <div className="context-card__info">
            <div className="context-card__title">
              <span className="web-element-context-card__tag">&lt;{context.tagName}&gt;</span>
            </div>
            {!compact && context.sourceUrl && (
              <div className="context-card__meta">
                <span title={context.sourceUrl}>
                  {i18nService.t('components:contextSystem.webElement.from')}{' '}
                  {clipHead(context.sourceUrl, SOURCE_URL_LIMIT)}
                </span>
              </div>
            )}
          </div>
        </div>

        {!compact && (
          <div className="web-element-context-card__details">
            <div className="web-element-context-card__path" title={context.path}>
              {clipTail(context.path, CSS_PATH_TAIL_LIMIT)}
            </div>
            {attrEntries.length > 0 && (
              <div className="web-element-context-card__attrs">
                {attrEntries.map(([key, value]) => (
                  <span key={key} className="web-element-context-card__attr">
                    <span className="web-element-context-card__attr-name">{key}</span>
                    {value && (
                      <>
                        <span className="web-element-context-card__attr-eq">=</span>
                        <span className="web-element-context-card__attr-val">
                          &quot;{clipHead(value, ATTRIBUTE_VALUE_LIMIT)}&quot;
                        </span>
                      </>
                    )}
                  </span>
                ))}
              </div>
            )}
            {context.textContent && (
              <div className="web-element-context-card__text">
                {clipHead(context.textContent, TEXT_PREVIEW_LIMIT)}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
}
