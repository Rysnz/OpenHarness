import yaml from 'yaml';

type IdentityFrontmatterField = keyof Omit<IdentityDocument, 'body'>;

export interface IdentityDocument {
  name: string;
  creature: string;
  vibe: string;
  emoji: string;
  avatarDataUrl?: string;
  body: string;
  modelPrimary?: string;
  modelFast?: string;
}

export const EMPTY_IDENTITY_DOCUMENT: IdentityDocument = {
  name: '',
  creature: '',
  vibe: '',
  emoji: '',
  avatarDataUrl: '',
  body: '',
  modelPrimary: '',
  modelFast: '',
};

const FRONTMATTER_FIELDS: IdentityFrontmatterField[] = [
  'name',
  'creature',
  'vibe',
  'emoji',
  'avatarDataUrl',
  'modelPrimary',
  'modelFast',
];

const OPTIONAL_FRONTMATTER_FIELDS = new Set<IdentityFrontmatterField>([
  'avatarDataUrl',
  'modelPrimary',
  'modelFast',
]);

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizeShortField(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/\s+/g, ' ').trim();
}

function serializeScalar(value: string): string {
  return yaml.stringify(value).trimEnd();
}

function trimIdentityBody(body: string): string {
  return normalizeLineEndings(body).replace(/^\n+/, '').trimEnd();
}

function normalizeDocument(document: IdentityDocument): Required<IdentityDocument> {
  return {
    name: normalizeShortField(document.name),
    creature: normalizeShortField(document.creature),
    vibe: normalizeShortField(document.vibe),
    emoji: normalizeShortField(document.emoji),
    avatarDataUrl: normalizeShortField(document.avatarDataUrl ?? ''),
    body: trimIdentityBody(document.body || ''),
    modelPrimary: normalizeShortField(document.modelPrimary ?? ''),
    modelFast: normalizeShortField(document.modelFast ?? ''),
  };
}

export function parseIdentityDocument(content: string): IdentityDocument {
  const normalizedContent = normalizeLineEndings(content || '');
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!frontmatterMatch) {
    return {
      ...EMPTY_IDENTITY_DOCUMENT,
      body: normalizedContent.trim(),
    };
  }

  const parsed = (yaml.parse(frontmatterMatch[1]) || {}) as Record<string, unknown>;
  return {
    name: normalizeShortField(parsed.name),
    creature: normalizeShortField(parsed.creature),
    vibe: normalizeShortField(parsed.vibe),
    emoji: normalizeShortField(parsed.emoji),
    avatarDataUrl: normalizeShortField(parsed.avatarDataUrl),
    body: trimIdentityBody(frontmatterMatch[2] ?? ''),
    modelPrimary: normalizeShortField(parsed.modelPrimary),
    modelFast: normalizeShortField(parsed.modelFast),
  };
}

export function serializeIdentityDocument(document: IdentityDocument): string {
  const normalized = normalizeDocument(document);

  const frontmatter = FRONTMATTER_FIELDS
    .filter((field) => !OPTIONAL_FRONTMATTER_FIELDS.has(field) || !!normalized[field])
    .map((field) => {
      const value = normalized[field];
      return value ? `${field}: ${serializeScalar(value)}` : `${field}:`;
    })
    .join('\n');

  return `---\n${frontmatter}\n---\n\n${normalized.body}`.trimEnd() + '\n';
}

export function getIdentityFilePath(workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${normalizedRoot}/IDENTITY.md`;
}
