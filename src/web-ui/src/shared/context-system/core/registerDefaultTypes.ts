import React from 'react';
import { Code, Code2 as Code2Icon, FileIcon, Network, type LucideIcon } from 'lucide-react';
import { i18nService } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { contextRegistry } from '../../services/ContextRegistry';
import {
  CodeSnippetCardRenderer,
  CodeSnippetContextTransformer,
  CodeSnippetContextValidator,
} from './types/CodeSnippetContextImpl';
import {
  FileCardRenderer,
  FileContextTransformer,
  FileContextValidator,
} from './types/FileContextImpl';
import {
  ImageCardRenderer,
  ImageContextTransformer,
  ImageContextValidator,
} from './types/ImageContextImpl';
import {
  MermaidDiagramCardRenderer,
  MermaidDiagramContextTransformer,
  MermaidDiagramContextValidator,
} from './types/MermaidDiagramContextImpl';
import {
  WebElementCardRenderer,
  WebElementContextTransformer,
  WebElementContextValidator,
} from './types/WebElementContextImpl';

const log = createLogger('ContextRegistry');

type DefaultContextDefinition = {
  type: string;
  nameKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  color: string;
  category: string;
  priority: number;
  cacheable: boolean;
  maxSize?: number;
  transformer: () => unknown;
  validator: () => unknown;
  renderer: () => unknown;
};

const defaultContextDefinitions: DefaultContextDefinition[] = [
  {
    type: 'file',
    nameKey: 'file',
    descriptionKey: 'file',
    icon: FileIcon,
    color: '#60a5fa',
    category: 'file',
    maxSize: 50 * 1024 * 1024,
    cacheable: true,
    priority: 1,
    transformer: () => new FileContextTransformer(),
    validator: () => new FileContextValidator(),
    renderer: () => new FileCardRenderer(),
  },
  {
    type: 'directory',
    nameKey: 'directory',
    descriptionKey: 'directory',
    icon: FileIcon,
    color: '#8b5cf6',
    category: 'file',
    cacheable: true,
    priority: 2,
    transformer: () => new FileContextTransformer(),
    validator: () => new FileContextValidator(),
    renderer: () => new FileCardRenderer(),
  },
  {
    type: 'code-snippet',
    nameKey: 'codeSnippet',
    descriptionKey: 'codeSnippet',
    icon: Code,
    color: '#a78bfa',
    category: 'code',
    maxSize: 100000,
    cacheable: false,
    priority: 5,
    transformer: () => new CodeSnippetContextTransformer(),
    validator: () => new CodeSnippetContextValidator(),
    renderer: () => new CodeSnippetCardRenderer(),
  },
  {
    type: 'mermaid-diagram',
    nameKey: 'mermaidDiagram',
    descriptionKey: 'mermaidDiagram',
    icon: Network,
    color: '#22c55e',
    category: 'diagram',
    maxSize: 50000,
    cacheable: false,
    priority: 4,
    transformer: () => new MermaidDiagramContextTransformer(),
    validator: () => new MermaidDiagramContextValidator(),
    renderer: () => new MermaidDiagramCardRenderer(),
  },
  {
    type: 'image',
    nameKey: 'image',
    descriptionKey: 'image',
    icon: FileIcon,
    color: '#f59e0b',
    category: 'media',
    maxSize: 20 * 1024 * 1024,
    cacheable: true,
    priority: 3,
    transformer: () => new ImageContextTransformer(),
    validator: () => new ImageContextValidator(),
    renderer: () => new ImageCardRenderer(),
  },
  {
    type: 'web-element',
    nameKey: 'webElement',
    descriptionKey: 'webElement',
    icon: Code2Icon,
    color: '#38bdf8',
    category: 'reference',
    maxSize: 50000,
    cacheable: false,
    priority: 6,
    transformer: () => new WebElementContextTransformer(),
    validator: () => new WebElementContextValidator(),
    renderer: () => new WebElementCardRenderer(),
  },
];

function i18nKey(kind: string, field: 'name' | 'description'): string {
  return `components:contextSystem.contextRegistry.${kind}.${field}`;
}

function registerDefinition(definition: DefaultContextDefinition): boolean {
  try {
    contextRegistry.register({
      type: definition.type,
      displayName: i18nService.t(i18nKey(definition.nameKey, 'name')),
      description: i18nService.t(i18nKey(definition.descriptionKey, 'description')),
      icon: React.createElement(definition.icon, { size: 16 }),
      color: definition.color,
      category: definition.category,
      transformer: definition.transformer(),
      validator: definition.validator(),
      renderer: definition.renderer(),
      config: {
        maxSize: definition.maxSize,
        cacheable: definition.cacheable,
        priority: definition.priority,
      },
    } as any);
    return true;
  } catch (error) {
    log.error(`Failed to register ${definition.type} type`, error as Error);
    return false;
  }
}

export function registerDefaultContextTypes(): void {
  const registeredCount = defaultContextDefinitions.filter(registerDefinition).length;
  log.info('Default context types registered', {
    count: registeredCount,
    types: contextRegistry.getAllTypes(),
  });
}
