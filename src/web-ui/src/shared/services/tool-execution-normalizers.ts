import {
  AdvancedToolResult,
  BashToolResult,
  FileToolResult,
  SearchToolResult,
  WebToolResult,
} from '../types/tool-display';

const compactToolName = (toolName: string): string => toolName.toLowerCase().replace(/[_-]/g, '');
const lineCount = (text: string): number => text.split('\n').length;

export function normalizeToolResult(result: any, toolName: string): any {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const content = result.content || result;

  switch (compactToolName(toolName)) {
    case 'bash':
      return normalizeBashResult(content);
    case 'fileread':
    case 'filewrite':
    case 'fileedit':
      return normalizeFileResult(content, toolName);
    case 'grep':
    case 'glob':
    case 'ls':
      return normalizeSearchResult(content);
    case 'websearch':
    case 'webfetch':
      return normalizeWebResult(content);
    case 'task':
    case 'think':
    case 'todowrite':
      return normalizeAdvancedResult(content, toolName);
    default:
      return content;
  }
}

function normalizeBashResult(content: any): BashToolResult {
  if (typeof content === 'string') {
    return {
      stdout: content,
      stdoutLines: lineCount(content),
      stderr: '',
      stderrLines: 0,
      interrupted: false,
    };
  }

  const stdout = content.stdout || content.output || '';
  const stderr = content.stderr || '';

  return {
    stdout,
    stdoutLines: content.stdoutLines || lineCount(stdout),
    stderr,
    stderrLines: content.stderrLines || lineCount(stderr),
    interrupted: content.interrupted || false,
    exitCode: content.exitCode,
  };
}

function normalizeFileResult(content: any, toolName: string): FileToolResult {
  const normalizedName = toolName.toLowerCase();
  const operation = normalizedName.includes('read')
    ? 'read'
    : normalizedName.includes('write')
      ? 'write'
      : normalizedName.includes('edit')
        ? 'edit'
        : 'multi-edit';

  return {
    content: content.content || content.data || content,
    filePath: content.filePath || content.path || content.file || 'unknown',
    operation,
    changes: content.changes,
    success: content.success !== false,
  };
}

function normalizeSearchResult(content: any): SearchToolResult {
  return {
    pattern: content.pattern || content.query || '',
    results: content.results || content.matches || [],
    totalMatches: content.totalMatches || content.total || (content.results?.length || 0),
    filesSearched: content.filesSearched || content.files,
  };
}

function normalizeWebResult(content: any): WebToolResult {
  return {
    url: content.url,
    query: content.query,
    content: content.content || content.text || '',
    title: content.title,
    results: content.results || content.searchResults,
  };
}

function normalizeAdvancedResult(content: any, toolName: string): AdvancedToolResult {
  const normalizedName = toolName.toLowerCase();
  const type = normalizedName.includes('task')
    ? 'task'
    : normalizedName.includes('think')
      ? 'think'
      : normalizedName.includes('todo')
        ? 'todo'
        : normalizedName.includes('expert')
          ? 'expert'
          : normalizedName.includes('architect')
            ? 'architect'
            : 'task';

  return {
    type,
    content: content.content || content.text || content.result || content,
    agentType: content.agentType || content.agent_type,
    todos: content.todos,
    thinking: content.thinking,
    suggestions: content.suggestions,
  };
}
