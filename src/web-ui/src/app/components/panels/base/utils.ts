/**
 * Utility functions for panel content configuration and management.
 */

import React from 'react';
import {
  Code,
  FileText,
  GitBranch,
  Eye,
  Edit3,
  BookOpen,
  Settings,
  ClipboardList,
  Image,
  Network,
  MessageSquareQuote,
  Globe,
} from 'lucide-react';
import { PanelContentType, PanelContentConfig } from './types';

type PanelIcon = PanelContentConfig['icon'];
type PanelConfigOptions = Partial<Pick<
  PanelContentConfig,
  'supportsCopy' | 'supportsDownload' | 'showHeader'
>>;

interface PanelConfigSpec {
  type: PanelContentType;
  displayName: string;
  icon: PanelIcon;
  options?: PanelConfigOptions;
}

const DEFAULT_PANEL_OPTIONS: Required<PanelConfigOptions> = {
  supportsCopy: false,
  supportsDownload: false,
  showHeader: false,
};

const COPY_AND_DOWNLOAD: PanelConfigOptions = {
  supportsCopy: true,
  supportsDownload: true,
};

const HEADER_COPY_AND_DOWNLOAD: PanelConfigOptions = {
  ...COPY_AND_DOWNLOAD,
  showHeader: true,
};

const PANEL_CONFIG_SPECS: PanelConfigSpec[] = [
  { type: 'empty', displayName: 'Empty', icon: FileText },
  { type: 'code-preview', displayName: 'Code Preview', icon: Code, options: HEADER_COPY_AND_DOWNLOAD },
  { type: 'code-viewer', displayName: 'Code Viewer', icon: Code, options: COPY_AND_DOWNLOAD },
  { type: 'code-editor', displayName: 'Code Editor', icon: Code, options: COPY_AND_DOWNLOAD },
  { type: 'markdown-viewer', displayName: 'Markdown Viewer', icon: FileText, options: HEADER_COPY_AND_DOWNLOAD },
  { type: 'markdown-editor', displayName: 'Markdown Editor', icon: FileText, options: COPY_AND_DOWNLOAD },
  { type: 'mermaid-editor', displayName: 'Mermaid Editor', icon: Edit3, options: COPY_AND_DOWNLOAD },
  { type: 'text-viewer', displayName: 'Text Viewer', icon: Eye, options: HEADER_COPY_AND_DOWNLOAD },
  { type: 'file-viewer', displayName: 'File Viewer', icon: Code, options: COPY_AND_DOWNLOAD },
  { type: 'image-viewer', displayName: 'Image Viewer', icon: Image },
  { type: 'diff-code-editor', displayName: 'Diff Editor', icon: Code, options: COPY_AND_DOWNLOAD },
  { type: 'git-diff', displayName: 'Git Diff', icon: GitBranch, options: COPY_AND_DOWNLOAD },
  { type: 'git-settings', displayName: 'Git Settings', icon: GitBranch },
  { type: 'git-graph', displayName: 'Git Graph', icon: GitBranch },
  { type: 'git-branch-history', displayName: 'Git Branch History', icon: GitBranch },
  { type: 'ai-session', displayName: 'AI Session', icon: BookOpen },
  { type: 'planner', displayName: 'Planner', icon: ClipboardList },
  { type: 'ui-editor', displayName: 'UI Editor', icon: Edit3 },
  { type: 'ui-relation-graph', displayName: 'UI Relation Graph', icon: Network },
  { type: 'design-tokens', displayName: 'Design Tokens', icon: Settings },
  { type: 'task-detail', displayName: 'Task Detail', icon: ClipboardList },
  { type: 'plan-viewer', displayName: 'Plan Viewer', icon: ClipboardList },
  { type: 'btw-session', displayName: 'Side Session', icon: MessageSquareQuote },
  { type: 'terminal', displayName: 'Terminal', icon: Code },
  { type: 'browser', displayName: 'Browser', icon: Globe },
];

const FILE_EXTENSION_BY_TYPE = new Map<PanelContentType, string>([
  ['markdown-viewer', 'md'],
  ['markdown-editor', 'md'],
  ['mermaid-editor', 'mmd'],
]);

function createPanelConfig(spec: PanelConfigSpec): PanelContentConfig {
  return {
    ...DEFAULT_PANEL_OPTIONS,
    ...spec.options,
    type: spec.type,
    displayName: spec.displayName,
    icon: spec.icon,
  };
}

function getPanelConfig(type: PanelContentType): PanelContentConfig {
  return PANEL_CONTENT_CONFIGS[type] ?? PANEL_CONTENT_CONFIGS.empty;
}

export const PANEL_CONTENT_CONFIGS: Record<PanelContentType, PanelContentConfig> =
  PANEL_CONFIG_SPECS.reduce((configs, spec) => {
    configs[spec.type] = createPanelConfig(spec);
    return configs;
  }, {} as Record<PanelContentType, PanelContentConfig>);

export const getContentIcon = (type: PanelContentType): React.ReactElement => {
  const IconComponent = getPanelConfig(type).icon;
  return React.createElement(IconComponent, { size: 16 });
};

export const getContentTypeName = (type: PanelContentType): string => {
  return getPanelConfig(type).displayName;
};

export const supportsContentCopy = (type: PanelContentType): boolean => {
  return getPanelConfig(type).supportsCopy;
};

export const supportsContentDownload = (type: PanelContentType): boolean => {
  return getPanelConfig(type).supportsDownload;
};

export const shouldShowHeader = (type: PanelContentType): boolean => {
  return getPanelConfig(type).showHeader;
};

export const generateTabId = (): string => {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
};

export const generateFileName = (type: PanelContentType, title: string): string => {
  const baseName = title || 'content';
  const extension = FILE_EXTENSION_BY_TYPE.get(type) ?? 'txt';
  return `${baseName}.${extension}`;
};
