 

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, FileImage, FileJson, FileCode, File, Search as SearchIcon, ArrowLeft } from 'lucide-react';
import MCPAPI, { MCPResource } from '../../api/service-api/MCPAPI';
import { Button } from '../../../component-library';
import { createLogger } from '@/shared/utils/logger';
import './MCPResourceBrowser.scss';

const log = createLogger('MCPResourceBrowser');

interface MCPResourceBrowserProps {
  serverId?: string;
  onClose?: () => void;
}

function resourceMatchesQuery(resource: MCPResource, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return true;
  }

  return [resource.name, resource.uri, resource.description]
    .filter(Boolean)
    .some(value => value!.toLowerCase().includes(normalizedQuery));
}

function MimeTypeIcon({ mimeType }: { mimeType?: string }) {
  if (!mimeType) return <File size={16} />;
  if (mimeType.startsWith('text/')) return <FileText size={16} />;
  if (mimeType.startsWith('image/')) return <FileImage size={16} />;
  if (mimeType.includes('json')) return <FileJson size={16} />;
  if (mimeType.includes('html')) return <FileCode size={16} />;
  if (mimeType.includes('pdf')) return <FileText size={16} />;
  return <File size={16} />;
}

export const MCPResourceBrowser: React.FC<MCPResourceBrowserProps> = ({ serverId, onClose }) => {
  const { t } = useTranslation('settings/mcp');
  const [resources, setResources] = useState<MCPResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResource, setSelectedResource] = useState<MCPResource | null>(null);
  const [resourceContent, setResourceContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  const filteredResources = useMemo(() => {
    return resources.filter(resource => resourceMatchesQuery(resource, searchQuery));
  }, [resources, searchQuery]);

  const renderResourceContents = useCallback((response: Awaited<ReturnType<typeof MCPAPI.readResource>>) => {
    return response.contents
      .map((content, index) => {
        const header = response.contents.length > 1
          ? `#${index + 1} ${content.uri}${content.mimeType ? ` (${content.mimeType})` : ''}`
          : `${content.mimeType ? `[${content.mimeType}]` : ''}`;

        if (typeof content.content === 'string' && content.content.length > 0) {
          return header ? `${header}\n\n${content.content}` : content.content;
        }

        if (content.blob) {
          return `${header}\n\n${t('resourceBrowser.errors.binaryContent')}`;
        }

        return `${header}\n\n${t('resourceBrowser.errors.loadContentFailed')}`;
      })
      .join('\n\n---\n\n');
  }, [t]);

  const loadResources = useCallback(async () => {
    if (!serverId) {
      setResources([]);
      setSelectedResource(null);
      setResourceContent(null);
      return;
    }

    setLoading(true);
    try {
      const resourceList = await MCPAPI.listResources({
        serverId,
        refresh: true,
      });
      setResources(resourceList);
    } catch (error) {
      log.error('Failed to load resources', error);
      setResources([]);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    loadResources();
  }, [serverId, loadResources]);

  const loadResourceContent = async (resource: MCPResource) => {
    if (!serverId) {
      return;
    }

    setSelectedResource(resource);
    setLoadingContent(true);
    setResourceContent(null);

    try {
      const response = await MCPAPI.readResource({
        serverId,
        resourceUri: resource.uri,
      });

      const renderedContent = renderResourceContents(response);
      setResourceContent(renderedContent || t('resourceBrowser.empty.noResources'));
    } catch (error) {
      log.error('Failed to load resource content', { resourceUri: resource.uri, error });
      setResourceContent(t('resourceBrowser.errors.loadContentFailed'));
    } finally {
      setLoadingContent(false);
    }
  };

  return (
    <div className="mcp-resource-browser">
      <div className="browser-header">
        <h2>{t('resourceBrowser.title')}</h2>
        <div className="header-actions">
          <Button
            variant="secondary"
            size="small"
            onClick={loadResources}
          >
            {t('resourceBrowser.actions.refresh')}
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="small"
              onClick={onClose}
            >
              {t('resourceBrowser.actions.close')}
            </Button>
          )}
        </div>
      </div>

      <div className="browser-search">
        <input
          type="text"
          placeholder={t('resourceBrowser.search.placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      <div className="browser-content">
        <div className="resources-list">
          {loading ? (
            <div className="loading-state">{t('resourceBrowser.loading.resources')}</div>
          ) : filteredResources.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <SearchIcon size={28} />
              </div>
              <p>{searchQuery ? t('resourceBrowser.empty.noMatch') : t('resourceBrowser.empty.noResources')}</p>
            </div>
          ) : (
            filteredResources.map((resource) => (
              <div
                key={resource.uri}
                className={`resource-item ${selectedResource?.uri === resource.uri ? 'selected' : ''}`}
                onClick={() => loadResourceContent(resource)}
              >
                <div className="resource-icon"><MimeTypeIcon mimeType={resource.mimeType} /></div>
                <div className="resource-info">
                  <div className="resource-name">{resource.name}</div>
                  {resource.description && (
                    <div className="resource-description">{resource.description}</div>
                  )}
                  <div className="resource-uri">{resource.uri}</div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="resource-viewer">
          {selectedResource ? (
            <>
              <div className="viewer-header">
                <div className="viewer-title">
                  <span className="viewer-icon"><MimeTypeIcon mimeType={selectedResource.mimeType} /></span>
                  <span className="viewer-name">{selectedResource.title || selectedResource.name}</span>
                </div>
                {selectedResource.mimeType && (
                  <div className="viewer-mime-type">{selectedResource.mimeType}</div>
                )}
              </div>
              <div className="viewer-content">
                {loadingContent ? (
                  <div className="loading-content">{t('resourceBrowser.loading.content')}</div>
                ) : resourceContent ? (
                  <pre className="content-pre">{resourceContent}</pre>
                ) : null}
              </div>
            </>
          ) : (
            <div className="viewer-empty">
              <div className="empty-icon">
                <ArrowLeft size={28} />
              </div>
              <p>{t('resourceBrowser.empty.selectToView')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MCPResourceBrowser;
