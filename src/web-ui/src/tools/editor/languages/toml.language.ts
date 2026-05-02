import type * as Monaco from 'monaco-editor';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('toml.language');

const TOML_LANGUAGE_ID = 'toml';
const TOML_BRACKET_PAIRS: [string, string][] = [
  ['{', '}'],
  ['[', ']'],
  ['(', ')'],
];
const TOML_QUOTES: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
];
const TOML_PAIR_CHARS = [...TOML_BRACKET_PAIRS, ...TOML_QUOTES].map(([open, close]) => ({ open, close }));

export const tomlLanguageConfig: Monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#',
  },
  brackets: TOML_BRACKET_PAIRS,
  autoClosingPairs: TOML_PAIR_CHARS,
  surroundingPairs: TOML_PAIR_CHARS,
};

const numberRules: Monaco.languages.IMonarchLanguageRule[] = [
  [/\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?/, 'number.date'],
  [/[+-]?\d+\.\d+([eE][+-]?\d+)?/, 'number.float'],
  [/[+-]?\d+([eE][+-]?\d+)?/, 'number'],
  [/0x[0-9a-fA-F_]+/, 'number.hex'],
  [/0o[0-7_]+/, 'number.octal'],
  [/0b[01_]+/, 'number.binary'],
];

const keyRules: Monaco.languages.IMonarchLanguageRule[] = [
  [/^\s*([a-zA-Z_][a-zA-Z0-9_.-]*)(\s*)(=)/, ['key', '', 'operator']],
  [/([a-zA-Z_][a-zA-Z0-9_.-]*)(\s*)(=)/, ['key', '', 'operator']],
  [/"([^"\\]|\\.)*"(\s*)(=)/, ['key', '', 'operator']],
  [/'([^'\\]|\\.)*'(\s*)(=)/, ['key', '', 'operator']],
];

export const tomlLanguageTokens: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  keywords: ['true', 'false'],
  operators: ['='],
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
  ],

  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/^\s*\[([^\]]+)\]/, 'type.identifier'],
      ...numberRules,
      [/\b(true|false)\b/, 'keyword'],
      ...keyRules,
      [/"""/, { token: 'string.quote', next: '@multiLineString' }],
      [/'''/, { token: 'string.quote', next: '@multiLineLiteralString' }],
      [/"([^"\\]|\\.)*$/, 'string.invalid'],
      [/"/, { token: 'string.quote', next: '@string' }],
      [/'[^']*$/, 'string.invalid'],
      [/'/, { token: 'string.quote', next: '@literalString' }],
      [/[ \t\r\n]+/, ''],
      [/[{}[\]()]/, '@brackets'],
      [/,/, 'delimiter.comma'],
      [/\./, 'delimiter.dot'],
      [/=/, 'operator'],
    ],
    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"/, { token: 'string.quote', next: '@pop' }],
    ],
    literalString: [
      [/[^']+/, 'string'],
      [/'/, { token: 'string.quote', next: '@pop' }],
    ],
    multiLineString: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string.escape'],
      [/"""/, { token: 'string.quote', next: '@pop' }],
      [/./, 'string'],
    ],
    multiLineLiteralString: [
      [/[^']+/, 'string'],
      [/'''/, { token: 'string.quote', next: '@pop' }],
      [/./, 'string'],
    ],
  },
};

export function registerTomlLanguage(monaco: typeof Monaco): void {
  try {
    if (!monaco.languages.getLanguages().some(lang => lang.id === TOML_LANGUAGE_ID)) {
      monaco.languages.register({
        id: TOML_LANGUAGE_ID,
        extensions: ['.toml'],
        aliases: ['TOML', 'toml'],
        mimetypes: ['text/x-toml'],
      });
    }

    monaco.languages.setLanguageConfiguration(TOML_LANGUAGE_ID, tomlLanguageConfig);
    monaco.languages.setMonarchTokensProvider(TOML_LANGUAGE_ID, tomlLanguageTokens);
  } catch (error) {
    log.error('Failed to register TOML language', error);
    throw error;
  }
}
