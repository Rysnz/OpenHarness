/**
 * LSP plugin list UI.
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Trash2, CheckCircle, AlertCircle, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import { Button, Card, CardBody } from '@/component-library';
import { useLspPlugins } from '../../hooks/useLsp';
import type { LspPlugin } from '../../types';
import { useNotification } from '@/shared/notification-system';
import './LspPluginList.scss';

const VISIBLE_LANGUAGE_BADGES = 2;
const CAPABILITY_KEYS = ['completion', 'hover', 'definition', 'references', 'formatting'] as const;

export interface LspPluginListProps {
  className?: string;
  onInitialize?: () => void;
  onInstallPlugin?: () => void;
  isInitializing?: boolean;
  isInstalling?: boolean;
  /** Passes the internal reload function to the parent after mount. */
  onMountReload?: (reload: () => void) => void;
}

interface PluginItemProps {
  plugin: LspPlugin;
  isExpanded: boolean;
  onToggle: () => void;
  onUninstall: () => void;
  t: (key: string) => string;
}

function ListFrame({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={`lsp-plugin-list ${className || ''}`}>{children}</div>;
}

const PluginItem: React.FC<PluginItemProps> = ({ plugin, isExpanded, onToggle, onUninstall, t }) => {
  const visibleLanguages = plugin.languages.slice(0, VISIBLE_LANGUAGE_BADGES);
  const hiddenLanguageCount = plugin.languages.length - visibleLanguages.length;

  return (
    <Card variant="default" padding="none" className={`lsp-plugin-item ${isExpanded ? 'is-expanded' : ''}`}>
      <div className="lsp-plugin-item__header" onClick={onToggle}>
        <div className="lsp-plugin-item__toggle">
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>

        <div className="lsp-plugin-item__icon">
          <Package size={16} />
        </div>

        <div className="lsp-plugin-item__main">
          <span className="lsp-plugin-item__name">{plugin.name}</span>
          <span className="lsp-plugin-item__version">v{plugin.version}</span>
        </div>

        <div className="lsp-plugin-item__badges">
          {visibleLanguages.map(lang => (
            <span key={lang} className="lsp-plugin-item__badge">{lang}</span>
          ))}
          {hiddenLanguageCount > 0 && (
            <span className="lsp-plugin-item__badge-more">+{hiddenLanguageCount}</span>
          )}
        </div>
      </div>

      {isExpanded && (
        <CardBody className="lsp-plugin-item__details">
          <div className="lsp-plugin-item__section">
            <p className="lsp-plugin-item__description">{plugin.description}</p>
          </div>

          <div className="lsp-plugin-item__section">
            <div className="lsp-plugin-item__label">{t('pluginList.details.author')}</div>
            <div className="lsp-plugin-item__value">{plugin.author}</div>
          </div>

          <div className="lsp-plugin-item__section">
            <div className="lsp-plugin-item__label">{t('pluginList.details.languages')}</div>
            <div className="lsp-plugin-item__tags">
              {plugin.languages.map(lang => (
                <span key={lang} className="lsp-plugin-item__tag">{lang}</span>
              ))}
            </div>
          </div>

          <div className="lsp-plugin-item__section">
            <div className="lsp-plugin-item__label">{t('pluginList.details.capabilities')}</div>
            <div className="lsp-plugin-item__capabilities">
              {CAPABILITY_KEYS.filter(key => plugin.capabilities[key]).map(key => (
                <span key={key} className="lsp-plugin-item__capability">
                  <CheckCircle size={12} />
                  {t(`pluginList.details.${key}`)}
                </span>
              ))}
            </div>
          </div>

          <div className="lsp-plugin-item__actions">
            <Button
              variant="danger"
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall();
              }}
            >
              <Trash2 size={14} />
              {t('pluginList.uninstall')}
            </Button>
          </div>
        </CardBody>
      )}
    </Card>
  );
};

export const LspPluginList: React.FC<LspPluginListProps> = ({
  className,
  onInstallPlugin,
  isInstalling = false,
  onMountReload,
}) => {
  const { t } = useTranslation('settings/lsp');
  const { plugins, loading, error, reload, uninstallPlugin } = useLspPlugins();
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());
  const notification = useNotification();

  useEffect(() => {
    onMountReload?.(reload);
  }, [reload, onMountReload]);

  const togglePlugin = (pluginId: string) => {
    setExpandedPlugins(prev => {
      const next = new Set(prev);
      if (next.has(pluginId)) {
        next.delete(pluginId);
      } else {
        next.add(pluginId);
      }
      return next;
    });
  };

  const handleUninstall = async (pluginId: string) => {
    if (!confirm(t('pluginList.confirmUninstall', { pluginId }))) {
      return;
    }

    const success = await uninstallPlugin(pluginId);
    if (success) {
      notification.success(t('pluginList.uninstallSuccess'));
    } else {
      notification.error(t('pluginList.uninstallFailed'));
    }
  };

  if (loading) {
    return (
      <ListFrame className={className}>
        <div className="lsp-plugin-list__loading">
          <div className="spinner"></div>
          <p>{t('pluginList.loading')}</p>
        </div>
      </ListFrame>
    );
  }

  if (error) {
    return (
      <ListFrame className={className}>
        <div className="lsp-plugin-list__error">
          <AlertCircle size={32} />
          <p>{error}</p>
          <Button variant="secondary" size="small" onClick={reload}>
            {t('pluginList.retry')}
          </Button>
        </div>
      </ListFrame>
    );
  }

  if (plugins.length === 0) {
    return (
      <ListFrame className={className}>
        <div className="lsp-plugin-list__empty">
          <Package size={64} />
          {onInstallPlugin && (
            <Button
              variant="dashed"
              size="medium"
              onClick={onInstallPlugin}
              disabled={isInstalling}
            >
              <Upload size={16} />
              {isInstalling ? t('pluginList.installing') : t('pluginList.installButton')}
            </Button>
          )}
        </div>
      </ListFrame>
    );
  }

  return (
    <ListFrame className={className}>
      <div className="lsp-plugin-list__items">
        {plugins.map(plugin => (
          <PluginItem
            key={plugin.id}
            plugin={plugin}
            isExpanded={expandedPlugins.has(plugin.id)}
            onToggle={() => togglePlugin(plugin.id)}
            onUninstall={() => handleUninstall(plugin.id)}
            t={t}
          />
        ))}
      </div>
    </ListFrame>
  );
};
